#!/bin/bash

# Resume Analyzer — Cleanup script
# Empties S3 buckets and deletes CloudFormation stacks in reverse dependency order.
# Run from project root: ./infra/cleanup.sh

set -e

ENVIRONMENT=${ENVIRONMENT:-agentcore}
STACK_NAME="resume-analyzer-agents-strands-${ENVIRONMENT}"
REGION=${AWS_DEFAULT_REGION:-us-east-1}

echo "🧹 Resume Analyzer Cleanup"
echo "Environment: $ENVIRONMENT"
echo "Region: $REGION"
echo ""

# Use Python to empty buckets (handles versioned buckets) and delete stacks
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
python "$SCRIPT_DIR/cleanup_aws.py" --environment "$ENVIRONMENT" --region "$REGION"

echo ""
echo "✅ Cleanup complete"
