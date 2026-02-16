# Quick Reference Guide

## Deployment

```bash
# One-command deployment
./deploy.sh
```

This will:
1. Deploy CloudFormation stack (S3, Lambda, IAM)
2. Deploy AgentCore Runtime agent
3. Update Lambda with Agent ARN

## S3 Folder Structure

```
bucket-name/
└── SO-12345/              ← Service Order folder
    ├── jd/                ← Job Description folder
    │   └── job.txt        ← Triggers batch processing of ALL resumes
    └── resumes/           ← Resumes folder
        ├── resume1.pdf    ← Each triggers processing of THIS resume
        ├── resume2.pdf    ← Each triggers processing of THIS resume
        └── resume3.docx   ← Each triggers processing of THIS resume
```

## Trigger Behavior

**JD Upload**: Processes ALL existing resumes in batch
**Resume Upload**: Processes ONLY that resume (if JD exists)

## Upload Files

### Option 1: Helper Script (Recommended)

```bash
python setup_s3_structure.py <bucket> <so_name> <jd_file> [resumes...]

# Example - Efficient (resumes first, JD last for batch processing):
python setup_s3_structure.py \
  amzn-s3-resume-analyzer-bucket-agentcore-123456789 \
  SO-12345 \
  job_description.txt \
  resume1.pdf \
  resume2.pdf \
  resume3.docx
```

### Option 2: AWS CLI

```bash
BUCKET="amzn-s3-resume-analyzer-bucket-agentcore-123456789"
SO="SO-12345"

# Option A: Resumes first (efficient - 1 batch trigger)
aws s3 cp resume1.pdf s3://$BUCKET/$SO/resumes/
aws s3 cp resume2.pdf s3://$BUCKET/$SO/resumes/
aws s3 cp job_description.txt s3://$BUCKET/$SO/jd/  # Batch processes all

# Option B: JD first (incremental - triggers per resume)
aws s3 cp job_description.txt s3://$BUCKET/$SO/jd/
aws s3 cp resume1.pdf s3://$BUCKET/$SO/resumes/  # Processes resume1
aws s3 cp resume2.pdf s3://$BUCKET/$SO/resumes/  # Processes resume2
```

### Option 3: AWS Console

1. Navigate to S3 bucket
2. Create folder: `SO-12345`
3. Inside `SO-12345`, create folders: `jd` and `resumes`
4. **Efficient**: Upload resumes to `SO-12345/resumes/`, then JD to `SO-12345/jd/`
5. **Incremental**: Upload JD to `SO-12345/jd/`, then resumes as they arrive

## Monitoring

### Check Lambda Logs

```bash
aws logs tail /aws/lambda/ResumeAnalyzerTrigger-agentcore --follow
```

### Check AgentCore Invocations

```bash
# Via AWS Console
# Bedrock → AgentCore Runtime → Agents → resume_analyzer_agent → Invocations
```

### Check S3 Events

```bash
aws s3api get-bucket-notification-configuration \
  --bucket amzn-s3-resume-analyzer-bucket-agentcore-123456789
```

## Troubleshooting

### Lambda Not Triggering

1. Check S3 event notification is configured:
   ```bash
   aws s3api get-bucket-notification-configuration --bucket <bucket-name>
   ```

2. Verify file uploaded to correct path (must be in `*/jd/*`)

3. Check Lambda permissions:
   ```bash
   aws lambda get-policy --function-name ResumeAnalyzerTrigger-agentcore
   ```

### Lambda Failing

1. Check CloudWatch Logs:
   ```bash
   aws logs tail /aws/lambda/ResumeAnalyzerTrigger-agentcore --follow
   ```

2. Verify Agent ARN is set:
   ```bash
   aws lambda get-function-configuration \
     --function-name ResumeAnalyzerTrigger-agentcore \
     --query 'Environment.Variables.AGENT_ARN'
   ```

3. Verify Lambda has Bedrock permissions:
   ```bash
   aws iam get-role-policy \
     --role-name ResumeAnalyzerLambdaRole-agentcore \
     --policy-name LambdaS3BedrockPolicy
   ```

### No Resumes Found

1. Verify resumes exist in `SO-NAME/resumes/` folder
2. Check folder structure matches exactly
3. Ensure resume files are not in subfolders

## Manual Testing

### Test Lambda Directly

```bash
aws lambda invoke \
  --function-name ResumeAnalyzerTrigger-agentcore \
  --payload '{
    "Records": [{
      "s3": {
        "bucket": {"name": "bucket-name"},
        "object": {"key": "SO-12345/jd/job.txt"}
      }
    }]
  }' \
  response.json
```

### Test AgentCore Directly

```python
import boto3
import json

client = boto3.client('bedrock-agentcore')

response = client.invoke_agent_runtime(
    agentRuntimeArn='arn:aws:bedrock-agentcore:us-east-1:123456789:runtime/agent-xxx',
    qualifier='DEFAULT',
    payload=json.dumps({
        'bucket': 'bucket-name',
        'resume_key': 'SO-12345/resumes/resume.pdf',
        'job_description_key': 'SO-12345/jd/job.txt',
        'so_folder': 'SO-12345'
    })
)
```

## Common Commands

```bash
# Get stack outputs
aws cloudformation describe-stacks \
  --stack-name resume-analyzer-agents-strands-agentcore \
  --query 'Stacks[0].Outputs'

# List S3 contents
aws s3 ls s3://bucket-name/SO-12345/ --recursive

# Delete stack (cleanup)
aws cloudformation delete-stack \
  --stack-name resume-analyzer-agents-strands-agentcore

# Update Lambda with new Agent ARN
python update_stack_with_agent_arn.py <agent-arn>
```

## File Formats Supported

- **Job Descriptions**: .txt, .pdf, .docx
- **Resumes**: .txt, .pdf, .docx

## Limits

- Lambda timeout: 300 seconds (5 minutes)
- Max resumes per SO: Limited by Lambda timeout
- Concurrent Lambda executions: 1000 (default AWS limit)

## Cost Optimization

- Upload resumes first, JD last (single trigger)
- Use consistent SO naming convention
- Clean up old SO folders after processing
- Monitor CloudWatch Logs retention
