#!/usr/bin/env python3
"""
Deploy API Lambda function code.
Uploads zip to S3 and updates Lambda function code.
Can be run before or after CloudFormation stack deployment.
"""
import os
import sys
import zipfile
import subprocess
import shutil
import boto3
from pathlib import Path

# Script is in infra/; api/ is at repo root (sibling of infra/)
ROOT = Path(__file__).resolve().parents[1]

def create_api_zip():
    """Create ZIP of api/ with node_modules."""
    api_dir = ROOT / "api"
    if not api_dir.exists():
        print("❌ api/ directory not found")
        sys.exit(1)
    # Ensure node_modules exists
    if not (api_dir / "node_modules").exists():
        print("📦 Installing npm dependencies...")
        npm_path = shutil.which("npm") or (shutil.which("npm.cmd") if os.name == "nt" else None)
        if not npm_path:
            print("❌ npm not found in PATH")
            sys.exit(1)
        subprocess.run([npm_path, "install"], cwd=api_dir, check=True)
    zip_buffer = __import__("io").BytesIO()
    with zipfile.ZipFile(zip_buffer, "w", zipfile.ZIP_DEFLATED) as zf:
        for f in api_dir.rglob("*"):
            if f.is_file():
                arcname = f.relative_to(api_dir)
                zf.write(f, arcname)
    zip_buffer.seek(0)
    return zip_buffer.read()

def create_bootstrap_zip():
    """Create a minimal bootstrap zip for initial Lambda creation."""
    zip_buffer = __import__("io").BytesIO()
    with zipfile.ZipFile(zip_buffer, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("package.json", '{"type":"module"}')
        zf.writestr("lambda.js", "export const handler=async()=>({statusCode:200,headers:{\"Content-Type\":\"application/json\"},body:\"{}\"});")
    zip_buffer.seek(0)
    return zip_buffer.read()

def get_bucket_name(env, account_id):
    """Get the S3 bucket name for the given environment."""
    return f"amzn-s3-resume-analyzer-v2-bucket-{env}-{account_id}"

def deploy():
    env = os.getenv("ENVIRONMENT", "agentcore")
    region = os.getenv("AWS_DEFAULT_REGION", "us-east-1")
    function_name = f"ResumeAnalyzerApi-{env}"
    s3_key = "api-lambda/deployment.zip"
    
    sts = boto3.client("sts", region_name=region)
    account_id = sts.get_caller_identity()["Account"]
    bucket_name = get_bucket_name(env, account_id)
    
    s3_client = boto3.client("s3", region_name=region)
    
    # Check if bucket exists
    try:
        s3_client.head_bucket(Bucket=bucket_name)
    except s3_client.exceptions.ClientError as e:
        error_code = e.response.get("Error", {}).get("Code", "")
        if error_code in ["404", "NoSuchBucket"]:
            print(f"⚠️  Bucket {bucket_name} does not exist yet.")
            print(f"💡 Deploy the CloudFormation stack first to create the bucket, then run this script again.")
            sys.exit(1)
        else:
            raise
    
    # Check if zip already exists in S3
    zip_exists = False
    try:
        s3_client.head_object(Bucket=bucket_name, Key=s3_key)
        zip_exists = True
    except s3_client.exceptions.ClientError as e:
        if e.response.get("Error", {}).get("Code") != "404":
            raise
    
    # Check if Lambda exists
    lambda_client = boto3.client("lambda", region_name=region)
    lambda_exists = False
    try:
        lambda_client.get_function(FunctionName=function_name)
        lambda_exists = True
    except lambda_client.exceptions.ResourceNotFoundException:
        pass
    
    # If zip doesn't exist and Lambda doesn't exist, create bootstrap zip first
    if not zip_exists and not lambda_exists:
        print(f"📦 Creating bootstrap zip for initial Lambda creation...")
        bootstrap_content = create_bootstrap_zip()
        s3_client.put_object(
            Bucket=bucket_name,
            Key=s3_key,
            Body=bootstrap_content,
            ContentType="application/zip"
        )
        print(f"✅ Bootstrap zip uploaded to S3")
        print(f"💡 Deploy the CloudFormation stack to create the Lambda, then run this script again to upload the full code.")
        return
    
    # Create full API zip
    print(f"📦 Creating API Lambda deployment package...")
    zip_content = create_api_zip()
    
    # Upload to S3
    print(f"📤 Uploading to s3://{bucket_name}/{s3_key}...")
    s3_client.put_object(
        Bucket=bucket_name,
        Key=s3_key,
        Body=zip_content,
        ContentType="application/zip"
    )
    print(f"✅ Uploaded to S3")
    
    # Update Lambda function code (if it exists)
    if lambda_exists:
        try:
            print(f"🚀 Updating Lambda function {function_name}...")
            lambda_client.update_function_code(
                FunctionName=function_name,
                S3Bucket=bucket_name,
                S3Key=s3_key
            )
            print(f"✅ Lambda function updated successfully")
        except Exception as e:
            print(f"⚠️  Could not update Lambda function: {e}")
            print(f"💡 The code has been uploaded to S3. Update the Lambda manually or redeploy the stack.")
    else:
        print(f"💡 Lambda function {function_name} does not exist yet.")
        print(f"💡 Deploy the CloudFormation stack to create it (the zip is now in S3).")

if __name__ == "__main__":
    deploy()
