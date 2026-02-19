#!/usr/bin/env python3
"""
Deploy UI to S3 for CloudFront hosting.
Gets API Gateway URL from API stack, builds UI with VITE_API_BASE, uploads dist/ to S3.
"""
import os
import sys
import subprocess
import shutil
import boto3
from pathlib import Path

# Script is in infra/; ui/ is at repo root (sibling of infra/)
ROOT = Path(__file__).resolve().parents[1]

def get_api_gateway_url(region: str, stack_name: str) -> str:
    """Get ApiGatewayUrl output from API stack."""
    cfn = boto3.client("cloudformation", region_name=region)
    try:
        resp = cfn.describe_stacks(StackName=stack_name)
        outputs = resp["Stacks"][0].get("Outputs", [])
        for o in outputs:
            if o["OutputKey"] == "ApiGatewayUrl":
                return o["OutputValue"].rstrip("/")
    except Exception as e:
        print(f"❌ Failed to get API Gateway URL from {stack_name}: {e}")
        sys.exit(1)
    print(f"❌ ApiGatewayUrl not found in stack {stack_name}")
    sys.exit(1)

def get_ui_bucket_name(region: str, stack_name: str) -> str:
    """Get UiBucketName output from UI stack."""
    cfn = boto3.client("cloudformation", region_name=region)
    try:
        resp = cfn.describe_stacks(StackName=stack_name)
        outputs = resp["Stacks"][0].get("Outputs", [])
        for o in outputs:
            if o["OutputKey"] == "UiBucketName":
                return o["OutputValue"]
    except Exception as e:
        print(f"❌ Failed to get UiBucketName from {stack_name}: {e}")
        sys.exit(1)
    print(f"❌ UiBucketName not found in stack {stack_name}")
    sys.exit(1)

def deploy():
    env = os.getenv("ENVIRONMENT", "agentcore")
    region = os.getenv("AWS_DEFAULT_REGION", "us-east-1")
    api_stack_name = f"resume-analyzer-agents-strands-{env}-api"
    ui_stack_name = f"resume-analyzer-agents-strands-{env}-ui"

    api_url = get_api_gateway_url(region, api_stack_name)
    api_base = f"{api_url}/api"
    print(f"📡 API base URL: {api_base}")

    bucket_name = get_ui_bucket_name(region, ui_stack_name)
    print(f"🪣 UI bucket: {bucket_name}")

    ui_dir = ROOT / "ui"
    if not ui_dir.exists():
        print("❌ ui/ directory not found")
        sys.exit(1)

    # Build with VITE_API_BASE (Git Bash + Windows compatible)
    env_vars = os.environ.copy()
    env_vars["VITE_API_BASE"] = api_base
    print("🔨 Building UI...")
    npm_path = shutil.which("npm") or (shutil.which("npm.cmd") if os.name == "nt" else None)
    if npm_path:
        result = subprocess.run(
            [npm_path, "run", "build"],
            cwd=ui_dir,
            env=env_vars,
            capture_output=True,
            text=True,
        )
    else:
        result = subprocess.run(
            "npm run build",
            cwd=ui_dir,
            env=env_vars,
            capture_output=True,
            text=True,
            shell=True,
        )
    if result.returncode != 0:
        print(result.stderr or result.stdout)
        sys.exit(1)
    print("✅ Build complete")

    dist_dir = ui_dir / "dist"
    if not dist_dir.exists():
        print("❌ ui/dist/ not found after build")
        sys.exit(1)

    # Upload dist/* to S3
    s3 = boto3.client("s3", region_name=region)
    for f in dist_dir.rglob("*"):
        if f.is_file():
            key = str(f.relative_to(dist_dir)).replace("\\", "/")
            content_type = "text/html" if f.suffix == ".html" else None
            if f.suffix == ".js":
                content_type = "application/javascript"
            elif f.suffix == ".css":
                content_type = "text/css"
            elif f.suffix in (".ico", ".png", ".jpg", ".jpeg", ".gif", ".svg", ".webp"):
                content_type = f"image/{f.suffix[1:]}" if f.suffix != ".svg" else "image/svg+xml"
            extra = {"ContentType": content_type} if content_type else {}
            s3.upload_file(str(f), bucket_name, key, ExtraArgs=extra)
            print(f"  📤 {key}")

    print("✅ UI deployed to S3")
    print("💡 Invalidate CloudFront cache if needed: aws cloudfront create-invalidation --distribution-id <ID> --paths '/*'")

if __name__ == "__main__":
    deploy()
