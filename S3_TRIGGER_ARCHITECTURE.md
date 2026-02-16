# S3-Triggered Resume Analysis Architecture

## Overview

The system now supports automatic resume analysis triggered by S3 uploads with the following structure:

```
s3://bucket-name/
├── SO-12345/
│   ├── jd/
│   │   └── job_description.txt
│   └── resumes/
│       ├── candidate1.pdf
│       ├── candidate2.pdf
│       └── candidate3.docx
├── SO-67890/
│   ├── jd/
│   │   └── job_posting.txt
│   └── resumes/
│       └── resume.pdf
```

## Architecture Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                         S3 Bucket                                │
│                  SO-XXXXX/jd/job_desc.txt                        │
└────────────────────────┬────────────────────────────────────────┘
                         │ (Upload triggers)
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│                    S3 Event Notification                         │
│              (Filter: */jd/* objects created)                    │
└────────────────────────┬────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Lambda Function                               │
│              (ResumeAnalyzerTrigger)                             │
│  1. Extract SO folder from S3 key                                │
│  2. List all resumes in SO-XXXXX/resumes/                       │
│  3. For each resume, invoke AgentCore Runtime                   │
└────────────────────────┬────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│              Amazon Bedrock AgentCore Runtime                    │
│                  (resume_analyzer_agent)                         │
│  • Processes each resume against job description                │
│  • Returns structured analysis                                  │
└─────────────────────────────────────────────────────────────────┘
```

## Setup Instructions

### 1. Deploy Infrastructure

```bash
# Deploy CloudFormation stack with Lambda and S3 trigger
./deploy.sh
```

This creates:
- S3 bucket with event notification
- Lambda function (with placeholder Agent ARN)
- IAM roles and permissions

### 2. Deploy AgentCore Runtime

The deploy script will automatically:
- Deploy the agent to Bedrock AgentCore Runtime
- Update Lambda function with the Agent ARN

### 3. Upload Files

Use the helper script to set up the folder structure:

```bash
python setup_s3_structure.py <bucket_name> <so_name> <jd_file> [resume_files...]

# Example:
python setup_s3_structure.py amzn-s3-resume-analyzer-bucket-agentcore-123456789 SO-12345 job_description.txt resume1.pdf resume2.pdf
```

Or manually upload:
1. Create folder structure: `SO-NAME/jd/` and `SO-NAME/resumes/`
2. Upload resumes to `SO-NAME/resumes/`
3. Upload job description to `SO-NAME/jd/` (this triggers analysis)

## How It Works

1. **Upload Resumes First**: Place all candidate resumes in `SO-NAME/resumes/` folder
2. **Upload JD to Trigger**: When you upload a job description to `SO-NAME/jd/`, the Lambda function is triggered
3. **Automatic Processing**: Lambda lists all resumes in the SO folder and invokes AgentCore for each one
4. **Parallel Analysis**: Each resume is analyzed against the job description independently

## Lambda Function

The Lambda function (`lambda_trigger.py`) performs:
- Extracts SO folder name from S3 event
- Lists all resumes in `SO-NAME/resumes/`
- Invokes AgentCore Runtime for each resume with payload:
  ```json
  {
    "bucket": "bucket-name",
    "resume_key": "SO-NAME/resumes/resume.pdf",
    "job_description_key": "SO-NAME/jd/job_desc.txt",
    "so_folder": "SO-NAME"
  }
  ```

## CloudFormation Resources

- **DocumentsBucket**: S3 bucket with event notification
- **TriggerLambdaFunction**: Lambda function triggered by S3
- **LambdaExecutionRole**: IAM role with S3 and Bedrock permissions
- **LambdaInvokePermission**: Allows S3 to invoke Lambda
- **AgentCoreExecutionRole**: IAM role for AgentCore Runtime

## Testing

1. Create test files locally
2. Run setup script to upload to S3
3. Check Lambda logs in CloudWatch
4. Verify AgentCore invocations in Bedrock console

## Notes

- Lambda timeout: 300 seconds (5 minutes)
- Only files in `*/jd/*` paths trigger the Lambda
- Resume files can be PDF, DOCX, or TXT format
- Each SO folder is independent and isolated
