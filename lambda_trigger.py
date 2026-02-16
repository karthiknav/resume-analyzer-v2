import json
import boto3
import os
import urllib.parse
import time
from datetime import datetime

agentcore_client = boto3.client('bedrock-agentcore')
s3_client = boto3.client('s3')
dynamodb = boto3.resource('dynamodb')

AGENT_ARN = 'arn:aws:bedrock-agentcore:us-east-1:206409480438:runtime/resume_analyzer_agent-j2SNsc9Nf9'
ENVIRONMENT = os.environ.get('ENVIRONMENT', 'agentcore')

job_table = dynamodb.Table(f'JobAnalysis-agentcore')
candidate_table = dynamodb.Table(f'CandidateAnalysis-agentcore')
counter_table = dynamodb.Table(f'Counters-agentcore')  # New counter table

def lambda_handler(event, context):
    """Triggered when JD or resume is uploaded to S3"""
    
    bucket = event['Records'][0]['s3']['bucket']['name']
    key = urllib.parse.unquote_plus(event['Records'][0]['s3']['object']['key'])
    
    parts = key.split('/')
    
    # Handle root-level JD upload: opportunities/sample.pdf
    if len(parts) == 2 and parts[0] == 'opportunities':
        return handle_root_jd_upload(bucket, key)
    
    # Only process files in nested structure: opportunities/SO-XXX/jd|resumes/file
    if len(parts) < 3:
        return {'statusCode': 200, 'body': 'Skipping - not in expected folder structure'}
    
    so_folder = parts[0]
    folder_type = parts[1]
    
    # JD uploaded - process all resumes
    if folder_type == 'jd':
        jd_key = key
        job_description_id = so_folder
        
        # Create/update job analysis record
        job_table.put_item(Item={
            'jobDescriptionId': job_description_id,
            'status': 'PROCESSING',
            'analysisS3Key': f's3://{bucket}/{jd_key}',
            'createdAt': datetime.utcnow().isoformat(),
            'updatedAt': datetime.utcnow().isoformat()
        })
        
        resumes_prefix = f"{so_folder}/resumes/"
        response = s3_client.list_objects_v2(Bucket=bucket, Prefix=resumes_prefix)
        
        if 'Contents' not in response:
            job_table.update_item(
                Key={'jobDescriptionId': job_description_id},
                UpdateExpression='SET #status = :status',
                ExpressionAttributeNames={'#status': 'status'},
                ExpressionAttributeValues={':status': 'NO_RESUMES'}
            )
            return {'statusCode': 200, 'body': 'No resumes found'}
        
        resume_keys = [obj['Key'] for obj in response['Contents'] if not obj['Key'].endswith('/')]
        
        for resume_key in resume_keys:
            candidate_id = resume_key.split('/')[-1].split('.')[0]
            
            # Create candidate analysis record
            candidate_table.put_item(Item={
                'jobDescriptionId': job_description_id,
                'candidateId': candidate_id,
                'candidateName': candidate_id,
                'analysisS3Key': f's3://{bucket}/analysis/{job_description_id}/{candidate_id}.json',
                'status': 'PROCESSING',
                'createdAt': datetime.utcnow().isoformat(),
                'updatedAt': datetime.utcnow().isoformat()
            })
            
            payload = {
                "bucket": bucket,
                "resume_key": resume_key,
                "job_description_key": jd_key,
                "so_folder": so_folder,
                "job_description_id": job_description_id,
                "candidate_id": candidate_id
            }
            
            boto3_response = agentcore_client.invoke_agent_runtime(
                agentRuntimeArn=AGENT_ARN,
                qualifier="DEFAULT",
                runtimeSessionId=f"resume-{job_description_id}-{candidate_id}",
                payload=json.dumps(payload)
            )
        
        job_table.update_item(
            Key={'jobDescriptionId': job_description_id},
            UpdateExpression='SET #status = :status, totalCandidates = :total',
            ExpressionAttributeNames={'#status': 'status'},
            ExpressionAttributeValues={':status': 'IN_PROGRESS', ':total': len(resume_keys)}
        )
        
        return {'statusCode': 200, 'body': json.dumps(f'JD uploaded: Processed {len(resume_keys)} resumes')}
    
    # Resume uploaded - process with existing JD
    elif folder_type == 'resumes':
        resume_key = key
        job_description_id = so_folder
        candidate_id = resume_key.split('/')[-1].split('.')[0]
        
        jd_prefix = f"{so_folder}/jd/"
        response = s3_client.list_objects_v2(Bucket=bucket, Prefix=jd_prefix)
        
        if 'Contents' not in response:
            return {'statusCode': 200, 'body': 'No JD found yet'}
        
        jd_keys = [obj['Key'] for obj in response['Contents'] if not obj['Key'].endswith('/')]
        if not jd_keys:
            return {'statusCode': 200, 'body': 'No JD found yet'}
        
        jd_key = jd_keys[0]
        
        # Create candidate analysis record
        candidate_table.put_item(Item={
            'jobDescriptionId': job_description_id,
            'candidateId': candidate_id,
            'candidateName': candidate_id,
            'analysisS3Key': f's3://{bucket}/analysis/{job_description_id}/{candidate_id}.json',
            'status': 'PROCESSING',
            'createdAt': datetime.utcnow().isoformat(),
            'updatedAt': datetime.utcnow().isoformat()
        })
        
        payload = {
            "bucket": bucket,
            "resume_key": resume_key,
            "job_description_key": jd_key,
            "so_folder": so_folder,
            "job_description_id": job_description_id,
            "candidate_id": candidate_id
        }
        boto3_response = agentcore_client.invoke_agent_runtime(
            agentRuntimeArn=AGENT_ARN,
            qualifier="DEFAULT",
            runtimeSessionId=f"resume-{job_description_id}-{candidate_id}",
            payload=json.dumps(payload)
        )
        
        return {'statusCode': 200, 'body': json.dumps(f'Resume uploaded: Processed against {jd_key}')}
    
    return {'statusCode': 400, 'body': 'Invalid folder type'}

def handle_root_jd_upload(bucket, original_key):
    """Handle JD uploaded directly to opportunities/ folder"""
    # Get next ID from DynamoDB counter
    response = counter_table.update_item(
        Key={'counterId': 'opportunity_id'},
        UpdateExpression='ADD currentValue :inc',
        ExpressionAttributeValues={':inc': 1},
        ReturnValues='UPDATED_NEW'
    )
    counter_value = int(response['Attributes']['currentValue'])
    so_id = f"SO_{counter_value:06d}"
    
    new_jd_key = f"opportunities/{so_id}/jd/{original_key.split('/')[-1]}"
    
    s3_client.copy_object(
        Bucket=bucket,
        CopySource={'Bucket': bucket, 'Key': original_key},
        Key=new_jd_key
    )
    s3_client.delete_object(Bucket=bucket, Key=original_key)
    
    # Invoke agent and get streaming response
    payload = {"bucket": bucket, "job_description_key": new_jd_key}
    boto3_response = agentcore_client.invoke_agent_runtime(
        agentRuntimeArn=AGENT_ARN,
        qualifier="DEFAULT",
        payload=json.dumps(payload)
    )
    
    # Wait for jd.json to be created
    jd_json_key = f"opportunities/{so_id}/jd/jd.json"
    max_retries = 10
    for i in range(max_retries):
        try:
            jd_data = json.loads(s3_client.get_object(Bucket=bucket, Key=jd_json_key)['Body'].read())
            break
        except s3_client.exceptions.NoSuchKey:
            if i < max_retries - 1:
                time.sleep(2)
            else:
                raise
    
    job_table.put_item(Item={
        'jobDescriptionId': so_id,
        'title': jd_data.get('title', 'N/A'),
        'client': jd_data.get('client', 'N/A'),
        'keywords': jd_data.get('keywords', []),
        's3Key': jd_json_key,
        'createdAt': datetime.utcnow().isoformat(),
        'status': 'ACTIVE'
    })
    
    return {'statusCode': 200, 'body': json.dumps(f'Created opportunity {so_id}')}

if __name__ == "__main__":
    # Local testing
    test_event = {
        'Records': [{
            's3': {
                'bucket': {'name': 'amzn-s3-resume-analyzer-v2-bucket-agentcore-206409480438'},
                'object': {'key': 'opportunities/sample_job_description_senior_java_cloud_engineer.pdf'}
            }
        }]
    }
    
    result = lambda_handler(test_event, None)
    print(json.dumps(result, indent=2))
