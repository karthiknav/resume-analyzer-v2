#!/usr/bin/env python3
"""Update CloudFormation stack with Agent ARN"""

import os
import sys
import boto3

def main():
    if len(sys.argv) < 2:
        print("Usage: python update_stack_with_agent_arn.py <agent_arn>")
        sys.exit(1)
    
    agent_arn = sys.argv[1]
    environment = os.getenv('ENVIRONMENT', 'agentcore')
    region = os.getenv('AWS_DEFAULT_REGION', 'us-east-1')
    stack_name = f"resume-analyzer-agents-strands-{environment}"
    
    cf = boto3.client('cloudformation', region_name=region)
    
    print(f"🔄 Updating stack {stack_name} with Agent ARN...")
    
    # Get current stack parameters
    response = cf.describe_stacks(StackName=stack_name)
    current_params = response['Stacks'][0]['Parameters']
    
    # Update AgentArn parameter
    new_params = []
    for param in current_params:
        if param['ParameterKey'] == 'AgentArn':
            new_params.append({'ParameterKey': 'AgentArn', 'ParameterValue': agent_arn})
        else:
            new_params.append({'ParameterKey': param['ParameterKey'], 'UsePreviousValue': True})
    
    # If AgentArn doesn't exist, add it
    if not any(p['ParameterKey'] == 'AgentArn' for p in new_params):
        new_params.append({'ParameterKey': 'AgentArn', 'ParameterValue': agent_arn})
    
    with open('template-infrastructure.yaml', 'r') as f:
        template_body = f.read()
    
    cf.update_stack(
        StackName=stack_name,
        TemplateBody=template_body,
        Parameters=new_params,
        Capabilities=['CAPABILITY_NAMED_IAM']
    )
    
    print(f"✅ Stack update initiated")
    print(f"   Agent ARN: {agent_arn}")

if __name__ == "__main__":
    main()
