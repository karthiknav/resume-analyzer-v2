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
    import traceback
    try:
        records = event.get('Records') or []
        if not records:
            print('[lambda] No Records in event; returning success')
            return {'statusCode': 200, 'body': 'No records to process'}
        record = records[0]
        bucket = record['s3']['bucket']['name']
        key = urllib.parse.unquote_plus(record['s3']['object']['key'])
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
        
        return {'statusCode': 400, 'body': 'Invalid folder type'}
    except Exception as e:
        print(f'[lambda] Unhandled exception: {e}')
        traceback.print_exc()
        raise


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
    s3_client.delete_object(Bucket=bucket, Key=original_key)

    # Wait for jd.json (or any JD file) to exist — agent may still be uploading after JD was created
    jd_prefix = f"opportunities/{so_id}/jd/"
    jd_json_key = f"opportunities/{so_id}/jd/jd.json"
    job_analysis_key = None
    max_jd_retries = 60
    for i in range(max_jd_retries):
        jd_response = s3_client.list_objects_v2(Bucket=bucket, Prefix=jd_prefix)
        jd_keys = [o['Key'] for o in jd_response.get('Contents', []) if not o['Key'].endswith('/')] if 'Contents' in jd_response else []
        if jd_json_key in jd_keys:
            job_analysis_key = jd_json_key
            break
        if jd_keys:
            job_analysis_key = jd_keys[0]
            break
        if i < max_jd_retries - 1:
            time.sleep(2)

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
    # 4. Wait for analysis.json, read overallScore, and update DynamoDB
    analysis_s3_key = f"opportunities/{so_id}/candidates/{candidate_id}/analysis.json"
    max_retries = 50
    status = 'PROCESSING'
    overall_score = 0
    candidate_name = candidate_id
    for i in range(max_retries):
        try:
            obj = s3_client.get_object(Bucket=bucket, Key=analysis_s3_key)
            body = obj.get('Body')
            if body:
                try:
                    analysis_data = json.loads(body.read().decode())
                    c = analysis_data.get('candidate') or {}
                    overall_score = int(c.get('overallScore', 0) or 0)
                    if c.get('name'):
                        candidate_name = c.get('name')
                except (json.JSONDecodeError, TypeError, ValueError):
                    pass  # keep overall_score 0, still mark COMPLETED
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
        'candidateName': candidate_name,
        'analysisS3Key': f's3://{bucket}/{analysis_s3_key}',
        'status': status,
        'overallScore': overall_score,
        'createdAt': datetime.utcnow().isoformat(),
        'updatedAt': datetime.utcnow().isoformat()
    })

    # If this is the first candidate for this job, update job opportunity status to "In Progress"
    cand_response = candidate_table.query(
        KeyConditionExpression='jobDescriptionId = :jid',
        ExpressionAttributeValues={':jid': so_id}
    )
    if cand_response.get('Count', 0) == 1:
        job_table.update_item(
            Key={'jobDescriptionId': so_id},
            UpdateExpression='SET #st = :status, updatedAt = :now',
            ExpressionAttributeNames={'#st': 'status'},
            ExpressionAttributeValues={':status': 'In Progress', ':now': datetime.utcnow().isoformat()}
        )

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
    
    # Wait for jd.json to be created (agent uploads it after processing the JD)
    jd_json_key = f"opportunities/{so_id}/jd/jd.json"
    max_retries = 60
    jd_data = None
    for i in range(max_retries):
        try:
            jd_data = json.loads(s3_client.get_object(Bucket=bucket, Key=jd_json_key)['Body'].read())
            break
        except ClientError as e:
            print(e.response)
            if e.response.get('Error', {}).get('Code') != 'NoSuchKey':
                raise
            if i < max_retries - 1:
                time.sleep(2)
            else:
                # Agent may still be writing; use defaults and do not throw
                print(f'[lambda] jd.json not found after {max_retries} retries; writing placeholder to DynamoDB')
                jd_data = {'summary': 'Pending', 'title': 'N/A', 'client': 'N/A', 'keywords': []}

    job_table.put_item(Item={
        'jobDescriptionId': so_id,
        'summary': jd_data.get('summary', 'N/A'),
        'title': jd_data.get('title', 'N/A'),
        'client': jd_data.get('client', 'N/A'),
        'keywords': jd_data.get('keywords', []),
        's3Key': jd_json_key,
        'createdAt': datetime.utcnow().isoformat(),
        'status': 'New'
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
