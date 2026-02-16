#!/usr/bin/env python3
"""Create S3 folder structure: opportunities/SO_ID/jd and opportunities/SO_ID/candidates/candidate_id"""

import boto3
import sys

def create_folder_structure(bucket_name):
    """Create sample folder structure in S3"""
    s3 = boto3.client('s3')
    
    # Create placeholder files to establish folder structure
    folders = [
        'opportunities/',
        'opportunities/SAMPLE_SO_1234/',
        'opportunities/SAMPLE_SO_1234/jd/',
        'opportunities/SAMPLE_SO_1234/candidates/',
        'opportunities/SAMPLE_SO_1234/candidates/SAMPLE_CANDIDATE_001/',
        'opportunities/SAMPLE_SO_1234/analysis/'
    ]
    
    print(f"📁 Creating folder structure in bucket: {bucket_name}")
    
    for folder in folders:
        try:
            s3.put_object(Bucket=bucket_name, Key=f"{folder}.keep", Body=b'')
            print(f"   ✅ {folder}")
        except Exception as e:
            print(f"   ❌ {folder}: {e}")
    
    print("\n✅ Folder structure created!")
    print("\n📋 Structure:")
    print("   opportunities/")
    print("   └── SO_ID/")
    print("       ├── jd/")
    print("       ├── candidates/")
    print("       │   └── candidate_id/")
    print("       └── analysis/")

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python create_s3_folders.py <bucket_name>")
        sys.exit(1)
    
    bucket_name = sys.argv[1]
    create_folder_structure(bucket_name)
