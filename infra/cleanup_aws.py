#!/usr/bin/env python3
"""
Cleanup script: empty S3 buckets and delete CloudFormation stacks.
Empties buckets before deletion (required for versioned buckets and non-empty buckets).
"""

import argparse
import sys
import time

import boto3
from botocore.exceptions import ClientError


def empty_bucket(s3_client, bucket_name: str) -> bool:
    """Empty S3 bucket, including all object versions and delete markers."""
    if not bucket_name:
        return True
    try:
        # Check if bucket exists
        s3_client.head_bucket(Bucket=bucket_name)
    except ClientError as e:
        code = e.response.get("Error", {}).get("Code", "")
        if code in ("404", "NoSuchBucket"):
            print(f"  ⏭️  Bucket {bucket_name} does not exist, skipping")
            return True
        raise

    print(f"  🗑️  Emptying bucket: {bucket_name}")

    paginator = s3_client.get_paginator("list_object_versions")
    deleted = 0
    for page in paginator.paginate(Bucket=bucket_name):
        objects = []
        for ver in page.get("Versions", []):
            objects.append({"Key": ver["Key"], "VersionId": ver.get("VersionId")})
        for marker in page.get("DeleteMarkers", []):
            objects.append({"Key": marker["Key"], "VersionId": marker.get("VersionId")})

        if objects:
            to_delete = []
            for o in objects:
                d = {"Key": o["Key"]}
                if o.get("VersionId"):
                    d["VersionId"] = o["VersionId"]
                to_delete.append(d)
            s3_client.delete_objects(
                Bucket=bucket_name,
                Delete={"Objects": to_delete, "Quiet": True},
            )
            deleted += len(objects)

    if deleted > 0:
        print(f"     Deleted {deleted} object(s)")
    else:
        print(f"     Bucket already empty")
    return True


def get_stack_output(cfn_client, stack_name: str, output_key: str) -> str | None:
    """Get a stack output value by key."""
    try:
        resp = cfn_client.describe_stacks(StackName=stack_name)
        outputs = resp["Stacks"][0].get("Outputs", [])
        for o in outputs:
            if o["OutputKey"] == output_key:
                return o["OutputValue"]
    except ClientError as e:
        if "does not exist" in str(e) or "Stack with id" in str(e):
            return None
        raise
    return None


def delete_stack(cfn_client, stack_name: str) -> bool:
    """Delete a CloudFormation stack and wait for completion."""
    try:
        cfn_client.describe_stacks(StackName=stack_name)
    except ClientError as e:
        if "does not exist" in str(e) or "Stack with id" in str(e):
            print(f"  ⏭️  Stack {stack_name} does not exist")
            return True
        raise

    print(f"  🗑️  Deleting stack: {stack_name}")
    cfn_client.delete_stack(StackName=stack_name)
    waiter = cfn_client.get_waiter("stack_delete_complete")
    try:
        waiter.wait(StackName=stack_name, WaiterConfig={"Delay": 5, "MaxAttempts": 60})
        print(f"     Deleted {stack_name}")
    except ClientError as e:
        if "does not exist" in str(e):
            print(f"     Deleted {stack_name}")
        else:
            raise
    return True


def main():
    parser = argparse.ArgumentParser(description="Cleanup Resume Analyzer AWS resources")
    parser.add_argument("--environment", "-e", default="agentcore")
    parser.add_argument("--region", "-r", default="us-east-1")
    args = parser.parse_args()

    env = args.environment
    region = args.region
    stack_prefix = f"resume-analyzer-agents-strands-{env}"
    api_stack = f"{stack_prefix}-api"
    ui_stack = f"{stack_prefix}-ui"
    storage_stack = f"{stack_prefix}-storage"
    roles_stack = f"{stack_prefix}-roles"

    cfn = boto3.client("cloudformation", region_name=region)
    s3 = boto3.client("s3", region_name=region)

    # 1. Get bucket names and empty them
    print("📦 Emptying S3 buckets...")
    ui_bucket = get_stack_output(cfn, ui_stack, "UiBucketName")
    docs_bucket = get_stack_output(cfn, storage_stack, "DocumentsBucket")
    if not ui_bucket or not docs_bucket:
        sts = boto3.client("sts", region_name=region)
        account_id = sts.get_caller_identity()["Account"]
        if not docs_bucket:
            docs_bucket = f"amzn-s3-resume-analyzer-v2-bucket-{env}-{account_id}"
        if not ui_bucket:
            ui_bucket = f"resume-analyzer-ui-{env}-{account_id}"

    empty_bucket(s3, ui_bucket)
    empty_bucket(s3, docs_bucket)
    print("  ⏳ Waiting 5s for S3 eventual consistency...")
    time.sleep(5)
    print("")

    # 2. Delete stacks in reverse dependency order
    print("🏗️  Deleting CloudFormation stacks...")
    for name in [api_stack, ui_stack, storage_stack, roles_stack]:
        delete_stack(cfn, name)
    print("")

    print("✅ Cleanup complete")


if __name__ == "__main__":
    main()
