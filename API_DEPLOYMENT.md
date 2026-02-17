# API Deployment (API Gateway + Lambda)

The API is deployed as an AWS Lambda function behind API Gateway. The Express app is wrapped with `@vendia/serverless-express`.

The infrastructure is split into three CloudFormation stacks:
1. **Roles stack** – IAM roles (AgentCore, trigger Lambda)
2. **Base stack** – S3 bucket, DynamoDB tables, trigger Lambda
3. **API stack** – API Lambda + API Gateway (deployed after `deploy_api_lambda.py` uploads the zip)

## Deployment Steps (Recommended: use deploy.sh)

```bash
./deploy.sh
```

This runs:
1. Deploy roles stack (`template-infrastructure-roles.yaml`)
2. Deploy base stack (`template-infrastructure-base.yaml`)
3. Run `deploy_api_lambda.py` (uploads zip to S3)
4. Deploy API stack (`template-infrastructure-api.yaml`)
5. Deploy trigger Lambda code

## Manual Deployment

### 1. Deploy roles stack

```bash
aws cloudformation deploy \
  --template-file template-infrastructure-roles.yaml \
  --stack-name resume-analyzer-agents-strands-agentcore-roles \
  --parameter-overrides Environment=agentcore \
  --capabilities CAPABILITY_NAMED_IAM
```

### 2. Deploy base stack

Get LambdaExecutionRoleArn from the roles stack, then:

```bash
LAMBDA_ROLE_ARN=$(aws cloudformation describe-stacks \
  --stack-name resume-analyzer-agents-strands-agentcore-roles \
  --query 'Stacks[0].Outputs[?OutputKey==`LambdaExecutionRoleArn`].OutputValue' --output text)

aws cloudformation deploy \
  --template-file template-infrastructure-base.yaml \
  --stack-name resume-analyzer-agents-strands-agentcore-base \
  --parameter-overrides Environment=agentcore AgentArn=PLACEHOLDER LambdaExecutionRoleArn=$LAMBDA_ROLE_ARN \
  --capabilities CAPABILITY_NAMED_IAM
```

### 3. Upload API Lambda code to S3

```bash
ENVIRONMENT=agentcore AWS_DEFAULT_REGION=us-east-1 python deploy_api_lambda.py
```

This packages the `api/` directory and uploads it to `s3://<bucket>/api-lambda/deployment.zip`.

### 4. Deploy API stack

Get the base stack outputs first, then:

```bash
DOCUMENTS_BUCKET=<from base stack>
JOB_ANALYSIS_TABLE=<from base stack>
CANDIDATE_ANALYSIS_TABLE=<from base stack>

aws cloudformation deploy \
  --template-file template-infrastructure-api.yaml \
  --stack-name resume-analyzer-agents-strands-agentcore-api \
  --parameter-overrides \
    Environment=agentcore \
    DocumentsBucketName=$DOCUMENTS_BUCKET \
    JobAnalysisTableName=$JOB_ANALYSIS_TABLE \
    CandidateAnalysisTableName=$CANDIDATE_ANALYSIS_TABLE \
    AgentArn=PLACEHOLDER \
  --capabilities CAPABILITY_NAMED_IAM
```

## API URL

After deployment, the API base URL is:

```
https://<api-id>.execute-api.<region>.amazonaws.com/prod
```

Append `/api/...` for routes, e.g.:
- `GET /api/opportunities`
- `POST /api/chat`

The API stack output `ApiGatewayUrl` shows the full base URL.

## How deploy_api_lambda.py works

- Checks if the S3 bucket exists
- If zip doesn't exist and Lambda doesn't exist: creates a minimal bootstrap zip and uploads it
- Otherwise: packages the full `api/` directory (including `node_modules`) and uploads it
- Updates the Lambda function code if it exists
- Uploads to `s3://<bucket>/api-lambda/deployment.zip`
