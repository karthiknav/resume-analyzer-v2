# Resume Analyzer Agent

## Overview

An AI-powered resume analysis system built on Amazon Bedrock AgentCore Runtime using multi-agent collaboration with Strands framework. The system evaluates candidate resumes against job descriptions using specialized AI agents with conversational memory.

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        Streamlit UI                              │
│                  (streamlit_display.py)                          │
└────────────────────────┬────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│              Amazon Bedrock AgentCore Runtime                    │
│                  (resume_analyzer_agent.py)                      │
├─────────────────────────────────────────────────────────────────┤
│  ┌───────────────────────────────────────────────────────────┐  │
│  │           HR Supervisor Agent (Orchestrator)              │  │
│  │  • Coordinates specialized agents                         │  │
│  │  • Manages workflow and final evaluation                  │  │
│  │  • Memory-enabled for follow-up questions                 │  │
│  └───────────────────────────────────────────────────────────┘  │
│                              │                                   │
│              ┌───────────────┼───────────────┬───────────────┐  │
│              ▼               ▼               ▼               ▼  │
│  ┌─────────────────┐ ┌─────────────┐ ┌──────────────────┐      │
│  │ Resume Parser   │ │ Job Analyzer│ │ Resume Evaluator │      │
│  │ Agent (Tool)    │ │ Agent (Tool)│ │ Agent (Tool)     │      │
│  └─────────────────┘ └─────────────┘ └──────────────────┘      │
│              ▼               ▼               ▼                  │
│  ┌─────────────────┐ ┌─────────────────────────────────┐       │
│  │ Gap Identifier  │ │   Candidate Rater Agent (Tool)  │       │
│  │ Agent (Tool)    │ │                                 │       │
│  └─────────────────┘ └─────────────────────────────────┘       │
└─────────────────────────────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│                    AWS Infrastructure                            │
├─────────────────────────────────────────────────────────────────┤
│  • S3 Bucket (Resumes & Job Descriptions)                       │
│  • IAM Role (AgentCore Execution)                               │
│  • Memory Manager (Conversational Context)                      │
│  • CloudWatch Logs                                              │
└─────────────────────────────────────────────────────────────────┘
```

## Bedrock AgentCore Runtime - Detailed View

```mermaid
graph TB
    subgraph Runtime["🔷 Bedrock AgentCore Runtime"]
        Orchestrator["<b>Supervisor Agent (Orchestrator)</b><br/>Collates structured outputs → builds final Markdown analysis"]
        
        Tool1["① extract_resume_info<br/>ResumeParserAgent<br/>returns JSON (structured)"]
        Tool2["② analyze_job_requirements<br/>JobAnalyzerAgent<br/>returns JSON (structured)"]
        Tool3["③ evaluate_candidate_fit<br/>ResumeEvaluatorAgent<br/>returns JSON (structured)"]
        Tool4["④ identify_gaps<br/>GapIdentifierAgent<br/>returns JSON (structured)"]
        Tool5["⑤ rate_candidate<br/>CandidateRaterAgent<br/>returns JSON (structured)"]
        
        Note["📝 All tools return structured JSON<br/>Orchestrator merges results and renders Markdown output"]
        
        Orchestrator --> Tool1
        Orchestrator --> Tool2
        Orchestrator --> Tool3
        Orchestrator --> Tool4
        Orchestrator --> Tool5
    end
    
    Runtime --> Bedrock["🟣 Amazon Bedrock<br/>Claude 3.5 Sonnet"]
    Runtime --> S3["🟢 Amazon S3<br/>Documents Bucket"]
    Runtime --> IAM["⚙️ IAM Roles<br/>and Permissions"]
    
    style Runtime fill:#E8F0FE,stroke:#1a73e8,stroke-width:2px
    style Orchestrator fill:#ffffff,stroke:#1a73e8,stroke-width:2px
    style Tool1 fill:#ffffff,stroke:#5f6368,stroke-width:1px
    style Tool2 fill:#ffffff,stroke:#5f6368,stroke-width:1px
    style Tool3 fill:#ffffff,stroke:#5f6368,stroke-width:1px
    style Tool4 fill:#ffffff,stroke:#5f6368,stroke-width:1px
    style Tool5 fill:#ffffff,stroke:#5f6368,stroke-width:1px
    style Note fill:#fff2cc,stroke:#f29900,stroke-width:1px
    style Bedrock fill:#EFE7FD,stroke:#6f42c1,stroke-width:2px
    style S3 fill:#E6F4EA,stroke:#0b8043,stroke-width:2px
    style IAM fill:#F1F3F4,stroke:#5f6368,stroke-width:2px
```

### Tool Flow

1. **extract_resume_info(resume_text)** → Parses resume into structured data
2. **analyze_job_requirements(job_description)** → Extracts job requirements
3. **evaluate_candidate_fit(resume_info, job_requirements)** → Compares candidate vs job
4. **identify_gaps(resume_info, job_requirements)** → Finds missing qualifications
5. **rate_candidate(resume_info, job_requirements, evaluation_info)** → Provides 1-5 score

## Key Features

- **Multi-Agent Collaboration**: Supervisor agent orchestrates 5 specialized agents
- **Conversational Memory**: Session-based memory for follow-up questions
- **Document Processing**: Supports PDF, DOCX, and TXT formats
- **Structured Output**: Markdown-formatted evaluation reports
- **AWS Integration**: S3 storage, IAM roles, CloudWatch logging

## Setup

### 1. Install uv (if not already installed)

```bash
# Linux/macOS
curl -LsSf https://astral.sh/uv/install.sh | sh

# Windows
powershell -c "irm https://astral.sh/uv/install.ps1 | iex"
```

### 2. Create and Activate Virtual Environment

```bash
# Create virtual environment
uv venv

# Activate virtual environment
# Linux/macOS
source .venv/bin/activate

# Windows (PowerShell)
.venv\Scripts\activate

# Windows (Git Bash)
source .venv/Scripts/activate
```

### 3. Install Dependencies

```bash
# Install from requirements.txt
uv pip install -r requirements.txt
```

## Deployment

### 1. Deploy Infrastructure and Agent

Run the deployment script to create the CloudFormation stack and deploy the agent to Bedrock AgentCore Runtime:

```bash
# Linux/macOS/Git Bash
./deploy.sh

# Windows (PowerShell)
bash deploy.sh
```

This script will:
- Deploy CloudFormation stack (S3 bucket, IAM role)
- Configure and deploy the agent to Bedrock AgentCore Runtime

### 2. Run Streamlit UI

After successful deployment, launch the Streamlit interface:

```bash
streamlit run streamlit_display.py
```
