import json
import boto3
import os
import urllib.parse
from datetime import datetime

agentcore_client = boto3.client('bedrock-agentcore')
s3_client = boto3.client('s3')
dynamodb = boto3.resource('dynamodb')

AGENT_ARN = os.environ['AGENT_ARN']
ENVIRONMENT = os.environ.get('ENVIRONMENT', 'agentcore')

job_table = dynamodb.Table(f'JobAnalysis-{ENVIRONMENT}')
candidate_table = dynamodb.Table(f'CandidateAnalysis-{ENVIRONMENT}')

def lambda_handler(event, context):
    """Triggered when JD or resume is uploaded to S3"""
    
    bucket = event['Records'][0]['s3']['bucket']['name']
    key = urllib.parse.unquote_plus(event['Records'][0]['s3']['object']['key'])
    
    parts = key.split('/')
    if len(parts) < 3:
        return {'statusCode': 400, 'body': 'Invalid key structure'}
    
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
            
            agentcore_client.invoke_agent_runtime(
                agentRuntimeArn=AGENT_ARN,
                qualifier="DEFAULT",
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
        agentcore_client.invoke_agent_runtime(
            agentRuntimeArn=AGENT_ARN,
            qualifier="DEFAULT",
            payload=json.dumps(payload)
        )
        
        return {'statusCode': 200, 'body': json.dumps(f'Resume uploaded: Processed against {jd_key}')}
    
    return {'statusCode': 400, 'body': 'Invalid folder type'}
