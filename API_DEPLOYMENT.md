# API Deployment (API Gateway + Lambda)

The API is deployed as an AWS Lambda function behind API Gateway. The Express app is wrapped with `@vendia/serverless-express`.

The infrastructure is split into three CloudFormation stacks:
1. **Roles stack** – IAM roles (AgentCore, trigger Lambda)
2. **Storage stack** – S3 bucket + DynamoDB + Trigger Lambda (deployed twice: first with PLACEHOLDER, then updated with Agent ARN)
3. **API stack** – API Lambda + API Gateway (deployed after `deploy_api_lambda.py` uploads the zip)

## Deployment Steps (Recommended: use deploy.sh)

```bash
./deploy.sh
```

This runs:
1. Deploy roles stack (`template-infrastructure-roles.yaml`)
2. Deploy storage stack (`template-infrastructure-storage.yaml`) – S3 + DynamoDB + Trigger Lambda with AgentArn=PLACEHOLDER
3. Run `deploy_agent.py` – creates agent, writes Agent ARN to `.agent_arn`
4. Update storage stack with Agent ARN
5. Run `deploy_api_lambda.py` (uploads zip to S3)
6. Deploy API stack (`template-infrastructure-api.yaml`)
7. Deploy trigger Lambda code

## Manual Deployment

### 1. Deploy roles stack

```bash
aws cloudformation deploy \
  --template-file template-infrastructure-roles.yaml \
  --stack-name resume-analyzer-agents-strands-agentcore-roles \
  --parameter-overrides Environment=agentcore \
  --capabilities CAPABILITY_NAMED_IAM
```

### 2. Deploy storage stack (first time, with PLACEHOLDER)

```bash
LAMBDA_ROLE_ARN=$(aws cloudformation describe-stacks \
  --stack-name resume-analyzer-agents-strands-agentcore-roles \
  --query 'Stacks[0].Outputs[?OutputKey==`LambdaExecutionRoleArn`].OutputValue' --output text)

aws cloudformation deploy \
  --template-file template-infrastructure-storage.yaml \
  --stack-name resume-analyzer-agents-strands-agentcore-storage \
  --parameter-overrides Environment=agentcore AgentArn=PLACEHOLDER LambdaExecutionRoleArn=$LAMBDA_ROLE_ARN \
  --capabilities CAPABILITY_NAMED_IAM
```

### 3. Deploy agent

```bash
ENVIRONMENT=agentcore AWS_DEFAULT_REGION=us-east-1 python deploy_agent.py
```

This creates the agent and writes the Agent ARN to `.agent_arn`.

### 4. Update storage stack with Agent ARN

```bash
LAMBDA_ROLE_ARN=$(aws cloudformation describe-stacks \
  --stack-name resume-analyzer-agents-strands-agentcore-roles \
  --query 'Stacks[0].Outputs[?OutputKey==`LambdaExecutionRoleArn`].OutputValue' --output text)

AGENT_ARN=$(cat .agent_arn)

aws cloudformation deploy \
  --template-file template-infrastructure-storage.yaml \
  --stack-name resume-analyzer-agents-strands-agentcore-storage \
  --parameter-overrides Environment=agentcore AgentArn=$AGENT_ARN LambdaExecutionRoleArn=$LAMBDA_ROLE_ARN \
  --capabilities CAPABILITY_NAMED_IAM
```

### 5. Upload API Lambda code to S3

```bash
ENVIRONMENT=agentcore AWS_DEFAULT_REGION=us-east-1 python deploy_api_lambda.py
```

This packages the `api/` directory and uploads it to `s3://<bucket>/api-lambda/deployment.zip`.

### 6. Deploy API stack

Get the storage stack outputs and Agent ARN, then:

```bash
DOCUMENTS_BUCKET=$(aws cloudformation describe-stacks --stack-name resume-analyzer-agents-strands-agentcore-storage --query 'Stacks[0].Outputs[?OutputKey==`DocumentsBucket`].OutputValue' --output text)
JOB_ANALYSIS_TABLE=$(aws cloudformation describe-stacks --stack-name resume-analyzer-agents-strands-agentcore-storage --query 'Stacks[0].Outputs[?OutputKey==`JobAnalysisTableName`].OutputValue' --output text)
CANDIDATE_ANALYSIS_TABLE=$(aws cloudformation describe-stacks --stack-name resume-analyzer-agents-strands-agentcore-storage --query 'Stacks[0].Outputs[?OutputKey==`CandidateAnalysisTableName`].OutputValue' --output text)
AGENT_ARN=$(cat .agent_arn)

aws cloudformation deploy \
  --template-file template-infrastructure-api.yaml \
  --stack-name resume-analyzer-agents-strands-agentcore-api \
  --parameter-overrides \
    Environment=agentcore \
    DocumentsBucketName=$DOCUMENTS_BUCKET \
    JobAnalysisTableName=$JOB_ANALYSIS_TABLE \
    CandidateAnalysisTableName=$CANDIDATE_ANALYSIS_TABLE \
    AgentArn=$AGENT_ARN \
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
