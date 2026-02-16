# Infrastructure Changes Summary

## Modified Files

### 1. `template-infrastructure.yaml`
**Changes:**
- Added `AgentArn` parameter (placeholder, updated after agent deployment)
- Added `LambdaExecutionRole` with S3 and Bedrock permissions
- Added `TriggerLambdaFunction` (Python 3.12 runtime, 300s timeout)
- Added `LambdaInvokePermission` for S3 to invoke Lambda
- Modified `DocumentsBucket` to include S3 event notification (triggers on `*/jd/*` uploads)
- Added `LambdaFunctionArn` output

**Key Features:**
- Lambda function embedded inline (no separate deployment needed)
- S3 notification filters for JD folder uploads only
- Proper dependency ordering with `DependsOn`

### 2. `deploy_agent.py`
**Changes:**
- Added Lambda function update after agent deployment
- Updates Lambda environment variable `AGENT_ARN` with deployed agent ARN
- Includes error handling for Lambda update

## New Files Created

### 1. `lambda_trigger.py`
**Purpose:** Lambda function source code (also embedded in CloudFormation)

**Functionality:**
- Triggered by S3 ObjectCreated events in `*/jd/*` paths
- Extracts SO folder name from S3 key
- Lists all resumes in `SO-NAME/resumes/` folder
- Invokes AgentCore Runtime for each resume

**Environment Variables:**
- `AGENT_ARN`: Bedrock AgentCore Runtime ARN

### 2. `setup_s3_structure.py`
**Purpose:** Helper script to create S3 folder structure and upload files

**Usage:**
```bash
python setup_s3_structure.py <bucket> <so_name> <jd_file> [resumes...]
```

**Features:**
- Creates proper folder structure
- Uploads JD to `SO-NAME/jd/`
- Uploads resumes to `SO-NAME/resumes/`
- Displays folder tree

### 3. `update_stack_with_agent_arn.py`
**Purpose:** Manually update CloudFormation stack with Agent ARN (if needed)

**Usage:**
```bash
python update_stack_with_agent_arn.py <agent_arn>
```

### 4. `S3_TRIGGER_ARCHITECTURE.md`
**Purpose:** Complete documentation of the new architecture

**Contents:**
- Architecture diagrams
- Setup instructions
- How it works
- Testing guide

## S3 Folder Structure

```
bucket-name/
└── SO-XXXXX/
    ├── jd/
    │   └── job_description.txt  ← Upload triggers Lambda
    └── resumes/
        ├── candidate1.pdf
        ├── candidate2.pdf
        └── candidate3.docx
```

## Deployment Flow

1. **Initial Deployment:**
   ```bash
   ./deploy.sh
   ```
   - Deploys CloudFormation stack
   - Creates S3 bucket, Lambda, IAM roles
   - Lambda has placeholder Agent ARN

2. **Agent Deployment:**
   - `deploy_agent.py` runs automatically
   - Deploys agent to Bedrock AgentCore Runtime
   - Updates Lambda with actual Agent ARN

3. **Usage:**
   ```bash
   # Upload files
   python setup_s3_structure.py bucket SO-12345 jd.txt resume1.pdf resume2.pdf
   
   # Or manually upload to S3
   # Resumes first, then JD to trigger
   ```

## IAM Permissions

### Lambda Execution Role
- S3: GetObject, ListBucket
- Bedrock AgentCore: InvokeAgentRuntime
- CloudWatch Logs: Basic execution role

### AgentCore Execution Role
- (Unchanged from original)
- S3 full access
- Bedrock model invocation
- Memory management

## Key Design Decisions

1. **Inline Lambda Code**: Embedded in CloudFormation for simplicity (no separate ZIP deployment)
2. **S3 Filter**: Only `*/jd/*` paths trigger Lambda (prevents unnecessary invocations)
3. **Two-Stage Deployment**: Stack first, then agent (Lambda updated with ARN)
4. **SO Folder Isolation**: Each SO has independent folder structure
5. **Batch Processing**: Lambda processes all resumes when JD is uploaded

## Testing Checklist

- [ ] Deploy CloudFormation stack
- [ ] Verify S3 bucket created
- [ ] Verify Lambda function created
- [ ] Deploy AgentCore agent
- [ ] Verify Lambda updated with Agent ARN
- [ ] Upload test resumes to `SO-TEST/resumes/`
- [ ] Upload test JD to `SO-TEST/jd/`
- [ ] Check Lambda logs in CloudWatch
- [ ] Verify AgentCore invocations

## Rollback Plan

If issues occur:
1. Delete CloudFormation stack: `aws cloudformation delete-stack --stack-name resume-analyzer-agents-strands-agentcore`
2. Delete AgentCore agent via console or CLI
3. Redeploy from scratch

## Future Enhancements

- Add DynamoDB table to track analysis results
- Add SNS notifications for completion
- Add SQS queue for async processing
- Add Step Functions for complex workflows
- Add API Gateway for external triggers
