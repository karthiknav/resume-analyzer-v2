#!/bin/bash

# Resume Analyzer Agents - Strands AgentCore Implementation Deployment Script
# Order: roles -> storage (with PLACEHOLDER) -> deploy_agent -> storage (update with Agent ARN) -> deploy_api_lambda -> api stack -> deploy trigger Lambda
set -e

ENVIRONMENT="agentcore"
STACK_NAME="resume-analyzer-agents-strands-${ENVIRONMENT}"
REGION=${AWS_DEFAULT_REGION:-us-east-1}

echo "🚀 Deploying Resume Analyzer Agents - Strands AgentCore Implementation"
echo "Environment: $ENVIRONMENT"
echo "Region: $REGION"
echo "Stack: $STACK_NAME"
echo ""

# Step 1: Deploy roles stack (IAM roles)
echo "🏗️ Step 1: Deploying roles stack..."
ROLES_STACK_NAME="${STACK_NAME}-roles"
aws cloudformation deploy \
    --template-file template-infrastructure-roles.yaml \
    --stack-name $ROLES_STACK_NAME \
    --parameter-overrides Environment=$ENVIRONMENT \
    --capabilities CAPABILITY_NAMED_IAM \
    --region $REGION

LAMBDA_EXECUTION_ROLE_ARN=$(aws cloudformation describe-stacks \
    --stack-name $ROLES_STACK_NAME \
    --region $REGION \
    --query 'Stacks[0].Outputs[?OutputKey==`LambdaExecutionRoleArn`].OutputValue' \
    --output text)

echo "✅ Roles stack deployed"
echo ""

# Step 2: Deploy storage stack (S3 + DynamoDB + Trigger Lambda) with AgentArn=PLACEHOLDER
echo "🏗️ Step 2: Deploying storage stack (S3 + DynamoDB + Trigger Lambda)..."
STORAGE_STACK_NAME="${STACK_NAME}-storage"
aws cloudformation deploy \
    --template-file template-infrastructure-storage.yaml \
    --stack-name $STORAGE_STACK_NAME \
    --parameter-overrides Environment=$ENVIRONMENT AgentArn=PLACEHOLDER LambdaExecutionRoleArn=$LAMBDA_EXECUTION_ROLE_ARN \
    --capabilities CAPABILITY_NAMED_IAM \
    --region $REGION

DOCUMENTS_BUCKET=$(aws cloudformation describe-stacks \
    --stack-name $STORAGE_STACK_NAME \
    --region $REGION \
    --query 'Stacks[0].Outputs[?OutputKey==`DocumentsBucket`].OutputValue' \
    --output text)
JOB_ANALYSIS_TABLE=$(aws cloudformation describe-stacks \
    --stack-name $STORAGE_STACK_NAME \
    --region $REGION \
    --query 'Stacks[0].Outputs[?OutputKey==`JobAnalysisTableName`].OutputValue' \
    --output text)
CANDIDATE_ANALYSIS_TABLE=$(aws cloudformation describe-stacks \
    --stack-name $STORAGE_STACK_NAME \
    --region $REGION \
    --query 'Stacks[0].Outputs[?OutputKey==`CandidateAnalysisTableName`].OutputValue' \
    --output text)

echo "✅ Storage stack deployed:"
echo "  Documents Bucket: $DOCUMENTS_BUCKET"
echo ""

# Step 3: Deploy AgentCore agent (needs bucket from storage, role from roles)
echo "🤖 Step 3: Deploying AgentCore agent..."
export ENVIRONMENT=$ENVIRONMENT
export AWS_DEFAULT_REGION=$REGION
python deploy_agent.py

if [ -f ".agent_arn" ]; then
  AGENT_ARN=$(cat .agent_arn)
  echo "  Agent ARN: $AGENT_ARN"
else
  echo "⚠️  Warning: .agent_arn not found. Using PLACEHOLDER for base/API stacks."
  AGENT_ARN=PLACEHOLDER
fi
echo ""

# Step 4: Update storage stack with Agent ARN
echo "🏗️ Step 4: Updating storage stack with Agent ARN..."
aws cloudformation deploy \
    --template-file template-infrastructure-storage.yaml \
    --stack-name $STORAGE_STACK_NAME \
    --parameter-overrides Environment=$ENVIRONMENT AgentArn=$AGENT_ARN LambdaExecutionRoleArn=$LAMBDA_EXECUTION_ROLE_ARN \
    --capabilities CAPABILITY_NAMED_IAM \
    --region $REGION

echo "✅ Storage stack updated"
echo ""

# Step 5: Upload API Lambda zip to S3 (must exist before API stack deploys)
echo "📦 Step 5: Uploading API Lambda code to S3..."
python deploy_api_lambda.py
echo ""

# Step 6: Deploy API stack (API Gateway + API Lambda)
echo "🏗️ Step 6: Deploying API stack (API Gateway + Lambda)..."
API_STACK_NAME="${STACK_NAME}-api"
aws cloudformation deploy \
    --template-file template-infrastructure-api.yaml \
    --stack-name $API_STACK_NAME \
    --parameter-overrides \
        Environment=$ENVIRONMENT \
        DocumentsBucketName=$DOCUMENTS_BUCKET \
        JobAnalysisTableName=$JOB_ANALYSIS_TABLE \
        CandidateAnalysisTableName=$CANDIDATE_ANALYSIS_TABLE \
        AgentArn=$AGENT_ARN \
    --capabilities CAPABILITY_NAMED_IAM \
    --region $REGION

echo "✅ API stack deployed"
echo ""

# Step 7: Deploy trigger Lambda function code
echo "📦 Step 7: Deploying trigger Lambda function code..."
python deploy_lambda.py
echo ""

echo "🎉 Deployment completed successfully!"
