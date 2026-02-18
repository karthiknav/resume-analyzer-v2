#!/usr/bin/env python3
"""Deploy Resume Analyzer Agent to Bedrock AgentCore Runtime"""

import os
import boto3
from bedrock_agentcore_starter_toolkit import Runtime

def get_stack_output(stack_name: str, output_key: str, region: str) -> str:
    """Get CloudFormation stack output value"""
    cf = boto3.client('cloudformation', region_name=region)
    response = cf.describe_stacks(StackName=stack_name)
    outputs = response['Stacks'][0]['Outputs']
    for output in outputs:
        if output['OutputKey'] == output_key:
            return output['OutputValue']
    raise ValueError(f"Output {output_key} not found in stack {stack_name}")

def main():
    environment = os.getenv('ENVIRONMENT', 'agentcore')
    region = os.getenv('AWS_DEFAULT_REGION', 'us-east-1')
    base_name = f"resume-analyzer-agents-strands-{environment}"
    roles_stack = f"{base_name}-roles"
    storage_stack = f"{base_name}-storage"
    
    print(f"🤖 Deploying Resume Analyzer Agent to Bedrock AgentCore Runtime")
    print(f"Region: {region}")
    
    # Get infrastructure outputs from roles and storage stacks
    print("📋 Getting infrastructure outputs...")
    execution_role = get_stack_output(roles_stack, 'AgentCoreExecutionRoleArn', region)
    documents_bucket = get_stack_output(storage_stack, 'DocumentsBucket', region)
    
    print(f"  Execution Role: {execution_role}")
    print(f"  Documents Bucket: {documents_bucket}")
    
    # Set environment variable for agent
    os.environ['DOCUMENTS_BUCKET'] = documents_bucket
    
    # Configure AgentCore
    print("🔧 Configuring AgentCore...")
    agentcore_runtime = Runtime()
    response = agentcore_runtime.configure(
        entrypoint="resume_analyzer_agent.py",
        execution_role=execution_role,
        auto_create_ecr=True,
        requirements_file="requirements.txt",
        region=region,
        agent_name="resume_analyzer_agent"
    )
    print(f"✅ Configuration completed: {response}")
    
    # Launch agent
    print("🚀 Launching agent...")
    launch_result = agentcore_runtime.launch()
    print(f"✅ Launch completed: {launch_result.agent_arn}")
    
    agent_arn = launch_result.agent_arn
    status_response = agentcore_runtime.status()
    status = status_response.endpoint["status"]
    
    print(f"📊 Final status: {status}")
    print(f"🎉 Agent deployed successfully!")
    print(f"\n📋 Agent ARN: {agent_arn}")

    # Write ARN for deploy.sh to use
    with open('.agent_arn', 'w') as f:
        f.write(agent_arn)

if __name__ == "__main__":
    main()
