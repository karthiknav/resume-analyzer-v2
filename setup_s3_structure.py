#!/usr/bin/env python3
"""Helper script to create S3 folder structure and upload test files"""

import os
import sys
import boto3

def main():
    if len(sys.argv) < 4:
        print("Usage: python setup_s3_structure.py <bucket_name> <so_name> <jd_file> [resume_files...]")
        print("Example: python setup_s3_structure.py my-bucket SO-12345 job.txt resume1.pdf resume2.pdf")
        sys.exit(1)
    
    bucket_name = sys.argv[1]
    so_name = sys.argv[2]
    jd_file = sys.argv[3]
    resume_files = sys.argv[4:] if len(sys.argv) > 4 else []
    
    s3 = boto3.client('s3')
    
    print(f"📁 Setting up S3 structure for SO: {so_name}")
    print(f"   Bucket: {bucket_name}")
    
    # Upload JD
    jd_key = f"{so_name}/jd/{os.path.basename(jd_file)}"
    print(f"\n📄 Uploading JD: {jd_file} -> s3://{bucket_name}/{jd_key}")
    s3.upload_file(jd_file, bucket_name, jd_key)
    
    # Upload resumes
    if resume_files:
        print(f"\n📄 Uploading {len(resume_files)} resume(s):")
        for resume_file in resume_files:
            resume_key = f"{so_name}/resumes/{os.path.basename(resume_file)}"
            print(f"   {resume_file} -> s3://{bucket_name}/{resume_key}")
            s3.upload_file(resume_file, bucket_name, resume_key)
    
    print(f"\n✅ S3 structure created successfully!")
    print(f"\nFolder structure:")
    print(f"  {so_name}/")
    print(f"  ├── jd/")
    print(f"  │   └── {os.path.basename(jd_file)}")
    print(f"  └── resumes/")
    for resume_file in resume_files:
        print(f"      └── {os.path.basename(resume_file)}")

if __name__ == "__main__":
    main()
