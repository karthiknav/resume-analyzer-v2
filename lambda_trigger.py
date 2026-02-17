import json
import boto3
import os
import urllib.parse
import time
from datetime import datetime
from botocore.exceptions import ClientError

agentcore_client = boto3.client('bedrock-agentcore')
s3_client = boto3.client('s3')
dynamodb = boto3.resource('dynamodb')

AGENT_ARN = os.environ.get('AGENT_ARN', 'arn:aws:bedrock-agentcore:us-east-1:206409480438:runtime/resume_analyzer_agent-j2SNsc9Nf9')
ENVIRONMENT = os.environ.get('ENVIRONMENT', 'agentcore')

job_table = dynamodb.Table(f'JobAnalysis-{ENVIRONMENT}')
candidate_table = dynamodb.Table(f'CandidateAnalysis-{ENVIRONMENT}')
counter_table = dynamodb.Table(f'Counters-{ENVIRONMENT}')


def get_next_candidate_id():
    """Get unique candidate ID from counter table."""
    response = counter_table.update_item(
        Key={'counterId': 'candidate_id'},
        UpdateExpression='ADD currentValue :inc',
        ExpressionAttributeValues={':inc': 1},
        ReturnValues='UPDATED_NEW'
    )
    counter_value = int(response['Attributes']['currentValue'])
    return f"CAND_{counter_value:06d}"

def lambda_handler(event, context):
    """Triggered when JD or resume is uploaded to S3"""
    
    bucket = event['Records'][0]['s3']['bucket']['name']
    key = urllib.parse.unquote_plus(event['Records'][0]['s3']['object']['key'])
    
    parts = key.split('/')
    
    # Handle root-level JD upload: opportunities/sample.pdf
    if len(parts) == 2 and parts[0] == 'opportunities':
        return handle_root_jd_upload(bucket, key)
    
    # Only process files in nested structure: opportunities/SO-XXX/jd|resumes|candidates/file
    if len(parts) < 3:
        return {'statusCode': 200, 'body': 'Skipping - not in expected folder structure'}
    
    # Path formats: opportunities/SO_ID/jd/file, opportunities/SO_ID/resumes/file, opportunities/SO_ID/candidates/file
    so_folder = parts[0]
    folder_type = parts[2] if len(parts) >= 4 else parts[1]
    so_id = parts[1] if len(parts) >= 4 else parts[0]
    
    # Resume upload to candidates folder: opportunities/so_id/candidates/file.pdf
    if len(parts) >= 4 and folder_type == 'candidates':
        return handle_candidates_upload(bucket, key, parts, so_id)
    
    # JD uploaded - process all resumes
    if folder_type == 'jd':
        jd_key = key
        job_description_id = so_id if len(parts) >= 4 else so_folder
        
        # Create/update job analysis record
        job_table.put_item(Item={
            'jobDescriptionId': job_description_id,
            'status': 'PROCESSING',
            'analysisS3Key': f's3://{bucket}/{jd_key}',
            'createdAt': datetime.utcnow().isoformat(),
            'updatedAt': datetime.utcnow().isoformat()
        })
        
        resumes_prefix = f"{so_folder}/{job_description_id}/resumes/" if len(parts) >= 4 else f"{so_folder}/resumes/"
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
        job_description_id = so_id if len(parts) >= 4 else so_folder
        candidate_id = resume_key.split('/')[-1].split('.')[0]
        
        jd_prefix = f"{so_folder}/{job_description_id}/jd/" if len(parts) >= 4 else f"{so_folder}/jd/"
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


def handle_candidates_upload(bucket, original_key, parts, so_id):
    """
    Handle resume upload to opportunities/so_id/candidates/.
    1. Get unique candidate ID from counter table
    2. Move document to opportunities/so_id/candidates/candidate_id/resume.{ext}
    3. Invoke Bedrock agent with new key
    4. Wait for result, then update DynamoDB with candidateId, jobDescriptionId, analysisS3Key
    """
    # Ignore if uploaded directly into a candidate subfolder (e.g. candidates/CAND_000001/resume.pdf)
    if len(parts) > 4:
        return {'statusCode': 200, 'body': 'Skipping - file already in candidate subfolder'}

    original_filename = parts[-1]
    ext = original_filename.rsplit('.', 1)[-1] if '.' in original_filename else 'pdf'

    # 1. Get unique candidate ID from counter
    candidate_id = get_next_candidate_id()

    # 2. Move to opportunities/so_id/candidates/candidate_id/resume.{ext}
    new_key = f"opportunities/{so_id}/candidates/{candidate_id}/resume.{ext}"

    s3_client.copy_object(
        Bucket=bucket,
        CopySource={'Bucket': bucket, 'Key': original_key},
        Key=new_key
    )
    #s3_client.delete_object(Bucket=bucket, Key=original_key)

    # Ensure job analysis exists (prefer jd.json, else raw JD file)
    jd_prefix = f"opportunities/{so_id}/jd/"
    jd_response = s3_client.list_objects_v2(Bucket=bucket, Prefix=jd_prefix)
    jd_keys = [o['Key'] for o in jd_response.get('Contents', []) if not o['Key'].endswith('/')] if 'Contents' in jd_response else []

    jd_json_key = f"opportunities/{so_id}/jd/jd.json"
    job_analysis_key = jd_json_key if jd_json_key in jd_keys else (jd_keys[0] if jd_keys else None)

    if not job_analysis_key:
        return {'statusCode': 200, 'body': 'No job description found - upload JD first'}

    # 3. Invoke Bedrock agent
    payload = {
        "bucket": bucket,
        "resume_key": new_key,
        "job_analysis_key": job_analysis_key,
        "job_description_id": so_id,
        "candidate_id": candidate_id,
    }
    boto3_response = agentcore_client.invoke_agent_runtime(
        agentRuntimeArn=AGENT_ARN,
        qualifier="DEFAULT",
        payload=json.dumps(payload)
    )
    time.sleep(60)
    # 4. Wait for analysis.json and update DynamoDB
    analysis_s3_key = f"opportunities/{so_id}/candidates/{candidate_id}/analysis.json"
    max_retries = 30
    status = 'PROCESSING'
    for i in range(max_retries):
        try:
            s3_client.get_object(Bucket=bucket, Key=analysis_s3_key)
            status = 'COMPLETED'
            break
        except ClientError as e:
            if e.response.get('Error', {}).get('Code') != 'NoSuchKey':
                raise
            if i < max_retries - 1:
                time.sleep(2)

    candidate_table.put_item(Item={
        'jobDescriptionId': so_id,
        'candidateId': candidate_id,
        'candidateName': candidate_id,
        'analysisS3Key': f's3://{bucket}/{analysis_s3_key}',
        'status': status,
        'createdAt': datetime.utcnow().isoformat(),
        'updatedAt': datetime.utcnow().isoformat()
    })

    return {'statusCode': 200, 'body': json.dumps(f'Candidate {candidate_id} processed for {so_id}')}


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
        except ClientError as e:
            if e.response.get('Error', {}).get('Code') != 'NoSuchKey':
                raise
            if i < max_retries - 1:
                time.sleep(2)
            else:
                raise
    
    job_table.put_item(Item={
        'jobDescriptionId': so_id,
        'summary': jd_data.get('summary', 'N/A'),
        'title': jd_data.get('title', 'N/A'),
        'client': jd_data.get('client', 'N/A'),
        'keywords': jd_data.get('keywords', []),
        's3Key': jd_json_key,
        'createdAt': datetime.utcnow().isoformat(),
        'status': 'In Progress'
    })
    
    return {'statusCode': 200, 'body': json.dumps(f'Created opportunity {so_id}')}

if __name__ == "__main__":
    # Local testing - change key to test different flows
    # Root JD: 'opportunities/sample.pdf'
    # Candidates: 'opportunities/SO_000005/candidates/john_resume.pdf'
    test_event = {
        'Records': [{
            's3': {
                'bucket': {'name': 'amzn-s3-resume-analyzer-v2-bucket-agentcore-206409480438'},
                'object': {'key': 'opportunities/SO_000005/candidates/sample_resume_arjun_mehta.pdf'}
            }
        }]
    }

    result = lambda_handler(test_event, None)
    print(json.dumps(result, indent=2))
