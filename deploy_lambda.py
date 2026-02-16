#!/usr/bin/env python3
"""Deploy Lambda function code separately from infrastructure"""

import os
import sys
import boto3
import zipfile
from io import BytesIO

def create_lambda_zip():
    """Create ZIP file with Lambda function code"""
    zip_buffer = BytesIO()
    with zipfile.ZipFile(zip_buffer, 'w', zipfile.ZIP_DEFLATED) as zip_file:
        zip_file.write('lambda_trigger.py', 'lambda_trigger.py')
    zip_buffer.seek(0)
    return zip_buffer.read()

def deploy_lambda_code(function_name, region):
    """Deploy Lambda function code"""
    lambda_client = boto3.client('lambda', region_name=region)
    
    print(f"📦 Creating Lambda deployment package...")
    zip_content = create_lambda_zip()
    
    print(f"🚀 Deploying Lambda function code...")
    lambda_client.update_function_code(
        FunctionName=function_name,
        ZipFile=zip_content
    )
    
    print(f"✅ Lambda function code deployed successfully")

def main():
    environment = os.getenv('ENVIRONMENT', 'agentcore')
    region = os.getenv('AWS_DEFAULT_REGION', 'us-east-1')
    function_name = f"ResumeAnalyzerTrigger-{environment}"
    
    print(f"🔧 Deploying Lambda function: {function_name}")
    print(f"   Region: {region}")
    
    deploy_lambda_code(function_name, region)

if __name__ == "__main__":
    main()
