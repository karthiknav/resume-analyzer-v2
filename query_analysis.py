#!/usr/bin/env python3
"""Query DynamoDB tables for job and candidate analysis status"""

import boto3
import sys

def query_job_analysis(job_description_id, environment='agentcore'):
    """Query job analysis status"""
    dynamodb = boto3.resource('dynamodb')
    table = dynamodb.Table(f'JobAnalysis-{environment}')
    
    response = table.get_item(Key={'jobDescriptionId': job_description_id})
    
    if 'Item' in response:
        item = response['Item']
        print(f"\n📋 Job Analysis: {job_description_id}")
        print(f"   Status: {item.get('status')}")
        print(f"   S3 Key: {item.get('analysisS3Key')}")
        print(f"   Total Candidates: {item.get('totalCandidates', 0)}")
        print(f"   Created: {item.get('createdAt')}")
        print(f"   Updated: {item.get('updatedAt')}")
        return item
    else:
        print(f"❌ No job analysis found for: {job_description_id}")
        return None

def query_candidates(job_description_id, environment='agentcore'):
    """Query all candidates for a job"""
    dynamodb = boto3.resource('dynamodb')
    table = dynamodb.Table(f'CandidateAnalysis-{environment}')
    
    response = table.query(
        KeyConditionExpression='jobDescriptionId = :jd',
        ExpressionAttributeValues={':jd': job_description_id}
    )
    
    if response['Items']:
        print(f"\n👥 Candidates for {job_description_id}:")
        for item in response['Items']:
            print(f"\n   Candidate: {item.get('candidateName')} ({item.get('candidateId')})")
            print(f"   Status: {item.get('status')}")
            print(f"   S3 Key: {item.get('analysisS3Key')}")
            print(f"   Created: {item.get('createdAt')}")
        return response['Items']
    else:
        print(f"❌ No candidates found for: {job_description_id}")
        return []

def main():
    if len(sys.argv) < 2:
        print("Usage: python query_analysis.py <job_description_id> [environment]")
        print("Example: python query_analysis.py SO-12345 agentcore")
        sys.exit(1)
    
    job_description_id = sys.argv[1]
    environment = sys.argv[2] if len(sys.argv) > 2 else 'agentcore'
    
    print(f"🔍 Querying analysis for: {job_description_id}")
    print(f"   Environment: {environment}")
    
    job = query_job_analysis(job_description_id, environment)
    candidates = query_candidates(job_description_id, environment)
    
    print(f"\n📊 Summary:")
    print(f"   Job Status: {job.get('status') if job else 'NOT_FOUND'}")
    print(f"   Total Candidates: {len(candidates)}")

if __name__ == "__main__":
    main()
