#!/bin/bash

# Resume Analyzer Agents - Strands AgentCore Implementation Deployment Script
set -e

ENVIRONMENT="agentcore"
STACK_NAME="resume-analyzer-agents-strands-${ENVIRONMENT}"
REGION=${AWS_DEFAULT_REGION:-us-east-1}

echo "🚀 Deploying Resume Analyzer Agents - Strands AgentCore Implementation"
echo "Environment: $ENVIRONMENT"
echo "Region: $REGION"
echo "Stack: $STACK_NAME"

# # Check prerequisites
# echo "🔍 Checking prerequisites..."

# # Check AWS CLI
# if ! command -v aws &> /dev/null; then
#     echo "❌ AWS CLI is required but not installed"
#     exit 1
# fi

# # Install uv if not present
# if ! command -v uv &> /dev/null; then
#     echo "📦 Installing uv..."
#     curl -LsSf https://astral.sh/uv/install.sh | sh
#     export PATH="$HOME/.local/bin:$PATH"
# fi

# # Setup uv environment and install dependencies
# echo "📦 Setting up uv environment and installing dependencies..."
# uv venv --clear
# source .venv/bin/activate || source .venv/Scripts/activate
# uv pip install -r requirements.txt
# export UV_PROJECT_ENVIRONMENT=.venv

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

# Step 2: Deploy base infrastructure (bucket, DynamoDB, trigger Lambda)
echo "🏗️ Step 2: Deploying base infrastructure..."
BASE_STACK_NAME="${STACK_NAME}-base"
aws cloudformation deploy \
    --template-file template-infrastructure-base.yaml \
    --stack-name $BASE_STACK_NAME \
    --parameter-overrides Environment=$ENVIRONMENT AgentArn=PLACEHOLDER LambdaExecutionRoleArn=$LAMBDA_EXECUTION_ROLE_ARN \
    --capabilities CAPABILITY_NAMED_IAM \
    --region $REGION

# Get base stack outputs
echo "📋 Getting base stack outputs..."
DOCUMENTS_BUCKET=$(aws cloudformation describe-stacks \
    --stack-name $BASE_STACK_NAME \
    --region $REGION \
    --query 'Stacks[0].Outputs[?OutputKey==`DocumentsBucket`].OutputValue' \
    --output text)
JOB_ANALYSIS_TABLE=$(aws cloudformation describe-stacks \
    --stack-name $BASE_STACK_NAME \
    --region $REGION \
    --query 'Stacks[0].Outputs[?OutputKey==`JobAnalysisTableName`].OutputValue' \
    --output text)
CANDIDATE_ANALYSIS_TABLE=$(aws cloudformation describe-stacks \
    --stack-name $BASE_STACK_NAME \
    --region $REGION \
    --query 'Stacks[0].Outputs[?OutputKey==`CandidateAnalysisTableName`].OutputValue' \
    --output text)
EXECUTION_ROLE=$(aws cloudformation describe-stacks \
    --stack-name $ROLES_STACK_NAME \
    --region $REGION \
    --query 'Stacks[0].Outputs[?OutputKey==`AgentCoreExecutionRoleArn`].OutputValue' \
    --output text)

echo "✅ Base infrastructure deployed:"
echo "  Documents Bucket: $DOCUMENTS_BUCKET"
echo "  Execution Role: $EXECUTION_ROLE"
echo ""

# Step 3: Upload API Lambda zip to S3 (must exist before API stack deploys)
echo "📦 Step 3: Uploading API Lambda code to S3..."
export ENVIRONMENT=$ENVIRONMENT
export AWS_DEFAULT_REGION=$REGION
python deploy_api_lambda.py
echo ""

# Step 4: Deploy API stack (API Gateway + API Lambda)
echo "🏗️ Step 4: Deploying API stack (API Gateway + Lambda)..."
API_STACK_NAME="${STACK_NAME}-api"
aws cloudformation deploy \
    --template-file template-infrastructure-api.yaml \
    --stack-name $API_STACK_NAME \
    --parameter-overrides \
        Environment=$ENVIRONMENT \
        DocumentsBucketName=$DOCUMENTS_BUCKET \
        JobAnalysisTableName=$JOB_ANALYSIS_TABLE \
        CandidateAnalysisTableName=$CANDIDATE_ANALYSIS_TABLE \
        AgentArn=PLACEHOLDER \
    --capabilities CAPABILITY_NAMED_IAM \
    --region $REGION

echo "✅ API stack deployed"
echo ""

# Step 5: Deploy trigger Lambda function code
echo "📦 Step 5: Deploying trigger Lambda function code..."
python deploy_lambda.py
echo ""

# # Step 3: Configure and deploy AgentCore agent
# echo "🤖 Step 3: Configuring and deploying AgentCore agent..."

# # Deploy agent using standalone script
# export ENVIRONMENT=$ENVIRONMENT
# export AWS_DEFAULT_REGION=$REGION
# python deploy_agent.py

# # Get agent ARN from configuration
# if [ -f ".bedrock_agentcore.yaml" ]; then
#     AGENT_ARN=$(grep -A 10 "bedrock_agentcore:" bedrock_agentcore.yaml | grep "arn:" | awk '{print $2}' | tr -d '"')
#     echo "✅ Agent ARN: $AGENT_ARN"
# else
#     echo "⚠️ Could not find bedrock_agentcore.yaml configuration file"
# fi


# # Step 3: Test the deployment
# echo "🧪 Step 4: Testing the deployment..."

# # Test the AgentCore agent directly
# echo "Testing AgentCore agent..."
# #agentcore invoke '{"bucket": "'$DOCUMENTS_BUCKET'", "resume_key": "test/sample.txt", "candidate_id": "test-123"}'

# echo ""
# echo "🎉 Deployment completed successfully!"
# echo ""
# echo "📋 Summary:"
# echo "  Environment: $ENVIRONMENT"
# echo "  Region: $REGION"
# echo "  Documents Bucket: $DOCUMENTS_BUCKET"
# echo "  Agent ARN: $AGENT_ARN"
# echo ""
# echo "📝 Next steps:"
# echo "  1. Create SO folder structure: SO-NAME/jd/ and SO-NAME/resumes/"
# echo "  2. Upload resumes to s3://$DOCUMENTS_BUCKET/SO-NAME/resumes/"
# echo "  3. Upload job description to s3://$DOCUMENTS_BUCKET/SO-NAME/jd/ (triggers analysis)"
# echo ""
# echo "💡 Use helper script:"
# echo "  python setup_s3_structure.py $DOCUMENTS_BUCKET SO-12345 job.txt resume1.pdf resume2.pdf"
