# Resume Analyzer - S3 Triggered Workflow

## Complete Workflow Diagram

```
┌─────────────────────────────────────────────────────────────────────────┐
│                          DEPLOYMENT PHASE                                │
└─────────────────────────────────────────────────────────────────────────┘

    ./deploy.sh
         │
         ├──► 1. Deploy CloudFormation Stack
         │         ├── S3 Bucket (with event notification)
         │         ├── Lambda Function (placeholder Agent ARN)
         │         ├── IAM Roles (Lambda + AgentCore)
         │         └── S3 Event → Lambda trigger
         │
         └──► 2. Deploy AgentCore Agent
                   ├── Build & push Docker image
                   ├── Deploy to Bedrock AgentCore Runtime
                   └── Update Lambda with Agent ARN

┌─────────────────────────────────────────────────────────────────────────┐
│                          RUNTIME PHASE                                   │
└─────────────────────────────────────────────────────────────────────────┘

    User uploads files to S3
         │
         ▼
    ┌─────────────────────────────────────────┐
    │  S3 Bucket Structure                    │
    │  ├── SO-12345/                          │
    │  │   ├── jd/                            │
    │  │   │   └── job_description.txt  ◄──── Upload triggers Lambda
    │  │   └── resumes/                       │
    │  │       ├── candidate1.pdf             │
    │  │       ├── candidate2.pdf             │
    │  │       └── candidate3.docx            │
    └─────────────────────────────────────────┘
         │
         │ S3 Event: ObjectCreated (filter: */jd/*)
         │
         ▼
    ┌─────────────────────────────────────────┐
    │  Lambda Function                        │
    │  (ResumeAnalyzerTrigger)                │
    │                                         │
    │  1. Parse S3 event                      │
    │  2. Extract SO folder: "SO-12345"       │
    │  3. List resumes in SO-12345/resumes/   │
    │  4. For each resume:                    │
    │     └─► Invoke AgentCore Runtime        │
    └─────────────────────────────────────────┘
         │
         │ For each resume
         │
         ▼
    ┌─────────────────────────────────────────┐
    │  Bedrock AgentCore Runtime              │
    │  (resume_analyzer_agent)                │
    │                                         │
    │  Payload:                               │
    │  {                                      │
    │    "bucket": "bucket-name",             │
    │    "resume_key": "SO-12345/resumes/...",│
    │    "job_description_key": "SO-12345/jd/",│
    │    "so_folder": "SO-12345"              │
    │  }                                      │
    └─────────────────────────────────────────┘
         │
         ▼
    ┌─────────────────────────────────────────┐
    │  Multi-Agent Processing                 │
    │                                         │
    │  Supervisor Agent orchestrates:         │
    │  ├── Resume Parser Agent                │
    │  ├── Job Analyzer Agent                 │
    │  ├── Resume Evaluator Agent             │
    │  ├── Gap Identifier Agent               │
    │  └── Candidate Rater Agent              │
    └─────────────────────────────────────────┘
         │
         ▼
    ┌─────────────────────────────────────────┐
    │  Structured Analysis Output             │
    │  (Markdown formatted)                   │
    │                                         │
    │  • Candidate Summary                    │
    │  • Skills Match                         │
    │  • Experience Evaluation                │
    │  • Gap Analysis                         │
    │  • Overall Rating (1-5)                 │
    │  • Recommendations                      │
    └─────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────┐
│                          MONITORING                                      │
└─────────────────────────────────────────────────────────────────────────┘

    CloudWatch Logs
         ├── /aws/lambda/ResumeAnalyzerTrigger-agentcore
         └── /aws/bedrock-agentcore/runtimes/*

    Bedrock Console
         └── AgentCore Runtime → Agents → Invocations
```

## Sequence Diagram

```
User          S3 Bucket       Lambda          AgentCore       Multi-Agents
 │                │              │                │                │
 │ Upload resumes │              │                │                │
 ├───────────────►│              │                │                │
 │                │              │                │                │
 │ Upload JD      │              │                │                │
 ├───────────────►│              │                │                │
 │                │              │                │                │
 │                │ S3 Event     │                │                │
 │                ├─────────────►│                │                │
 │                │              │                │                │
 │                │              │ List resumes   │                │
 │                │◄─────────────┤                │                │
 │                │              │                │                │
 │                │              │ Invoke (resume1)                │
 │                │              ├───────────────►│                │
 │                │              │                │ Process        │
 │                │              │                ├───────────────►│
 │                │              │                │◄───────────────┤
 │                │              │◄───────────────┤                │
 │                │              │                │                │
 │                │              │ Invoke (resume2)                │
 │                │              ├───────────────►│                │
 │                │              │                │ Process        │
 │                │              │                ├───────────────►│
 │                │              │                │◄───────────────┤
 │                │              │◄───────────────┤                │
 │                │              │                │                │
 │                │              │ Invoke (resume3)                │
 │                │              ├───────────────►│                │
 │                │              │                │ Process        │
 │                │              │                ├───────────────►│
 │                │              │                │◄───────────────┤
 │                │              │◄───────────────┤                │
 │                │              │                │                │
 │                │◄─────────────┤ Complete       │                │
 │                │              │                │                │
```

## Data Flow

```
┌──────────────┐
│ Job Desc     │
│ (S3 Object)  │
└──────┬───────┘
       │
       ▼
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│ Resume 1     │     │ Resume 2     │     │ Resume 3     │
│ (S3 Object)  │     │ (S3 Object)  │     │ (S3 Object)  │
└──────┬───────┘     └──────┬───────┘     └──────┬───────┘
       │                    │                    │
       ▼                    ▼                    ▼
┌──────────────────────────────────────────────────────────┐
│              Lambda Function (Orchestrator)              │
└──────────────────────────────────────────────────────────┘
       │                    │                    │
       ▼                    ▼                    ▼
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│ AgentCore    │     │ AgentCore    │     │ AgentCore    │
│ Invocation 1 │     │ Invocation 2 │     │ Invocation 3 │
└──────┬───────┘     └──────┬───────┘     └──────┬───────┘
       │                    │                    │
       ▼                    ▼                    ▼
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│ Analysis 1   │     │ Analysis 2   │     │ Analysis 3   │
│ (Markdown)   │     │ (Markdown)   │     │ (Markdown)   │
└──────────────┘     └──────────────┘     └──────────────┘
```

## Component Interaction

```
┌─────────────────────────────────────────────────────────────┐
│                    AWS Account                              │
│                                                             │
│  ┌────────────────────────────────────────────────────┐    │
│  │  S3 Bucket                                         │    │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────┐        │    │
│  │  │ SO-12345 │  │ SO-67890 │  │ SO-11111 │  ...   │    │
│  │  └────┬─────┘  └──────────┘  └──────────┘        │    │
│  │       │                                            │    │
│  │       │ Event Notification (*/jd/*)               │    │
│  └───────┼────────────────────────────────────────────┘    │
│          │                                                  │
│          ▼                                                  │
│  ┌────────────────────────────────────────────────────┐    │
│  │  Lambda Function                                   │    │
│  │  ┌──────────────────────────────────────────────┐ │    │
│  │  │ Environment Variables:                       │ │    │
│  │  │ AGENT_ARN = arn:aws:bedrock-agentcore:...   │ │    │
│  │  └──────────────────────────────────────────────┘ │    │
│  │                                                    │    │
│  │  IAM Role: ResumeAnalyzerLambdaRole               │    │
│  │  ├── S3: GetObject, ListBucket                    │    │
│  │  └── Bedrock: InvokeAgentRuntime                  │    │
│  └────────────────┬───────────────────────────────────┘    │
│                   │                                         │
│                   ▼                                         │
│  ┌────────────────────────────────────────────────────┐    │
│  │  Bedrock AgentCore Runtime                         │    │
│  │  ┌──────────────────────────────────────────────┐ │    │
│  │  │ Agent: resume_analyzer_agent                 │ │    │
│  │  │ Runtime: Python 3.12                         │ │    │
│  │  │ Model: Claude 3.5 Sonnet                     │ │    │
│  │  └──────────────────────────────────────────────┘ │    │
│  │                                                    │    │
│  │  IAM Role: AgentCoreExecutionRole                 │    │
│  │  ├── S3: Full Access                              │    │
│  │  ├── Bedrock: InvokeModel                         │    │
│  │  └── Memory: Create, Retrieve                     │    │
│  └────────────────────────────────────────────────────┘    │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```
