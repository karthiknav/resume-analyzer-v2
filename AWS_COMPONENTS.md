# AWS Components — How They Interact

High-level view of how AWS services work together in the Resume Analyzer system.

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│                              UI (Static Assets)                                           │
│                        S3 + CloudFront (custom domain)                                     │
└─────────────────────────────────────────────────────────────────────────────────────────┘
                                          │
                                          │  HTTPS (API calls)
                                          ▼
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│                              API Gateway (REST API)                                        │
│                    https://xxx.execute-api.region.amazonaws.com/prod/api                   │
└─────────────────────────────────────────────────────────────────────────────────────────┘
                                          │
                                          │  Invokes
                                          ▼
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│                           API Lambda (Express middleware)                                  │
│  • Presigned URLs for S3 uploads   • DynamoDB read   • Invoke AgentCore (chat)            │
└─────────────────────────────────────────────────────────────────────────────────────────┘
          │                    │                              │
          │                    │                              │
          ▼                    ▼                              ▼
┌─────────────────┐   ┌─────────────────┐          ┌─────────────────────────┐
│       S3        │   │    DynamoDB     │          │  Bedrock AgentCore      │
│  (Documents)    │   │  JobAnalysis    │          │  Runtime                │
│                 │   │  CandidateAnalysis│         │  (resume_analyzer_agent)│
└────────┬────────┘   └─────────────────┘          └───────────┬─────────────┘
         │                                                     │
         │  S3 Event (ObjectCreated)                            │  Structured analysis
         │                                                     │  Short-term memory
         ▼                                                     │
┌─────────────────┐                                            │
│ Trigger Lambda  │ ──────────────────────────────────────────┘
│                 │   InvokeAgentRuntime
│  • JD upload    │   (JD parse → jd.json)
│  • Resume upload│   (Resume analysis → analysis.json)
└─────────────────┘
```

---

## Request Flow by Use Case

### 1. User opens UI → S3 + CloudFront

```
User browser ──► CloudFront (CDN) ──► S3 (ui/dist/*)
                     │
                     └── SPA: index.html, JS, CSS served from S3
```

- **CloudFront** serves the React app from the S3 bucket.
- Custom domain (e.g. `noonehasthisdomain.click`) uses ACM certificate.

---

### 2. API calls → API Gateway → API Lambda

```
UI fetch('/api/...') ──► API Gateway ──► API Lambda (Express)
                              │
                              └── Routes: /api/opportunities, /api/upload-url, /api/chat, etc.
```

- API Gateway receives all `/api/*` requests and forwards them to the API Lambda.
- API Lambda runs Express and handles presigned URLs, DynamoDB reads, and chat.

---

### 3. S3 upload → Trigger Lambda → Bedrock AgentCore

```
UI gets presigned URL from API Lambda
         │
         ▼
UI PUT to S3 (direct upload, no Lambda in path)
         │
         ▼
S3 ObjectCreated event ──► Trigger Lambda
                                │
                                ├── JD upload: handle_root_jd_upload()
                                │      • Move to opportunities/SO_XXXXXX/jd/
                                │      • Invoke AgentCore with job_description_key
                                │      • Agent parses JD → writes jd.json
                                │      • Lambda writes JobAnalysis (DynamoDB)
                                │
                                └── Resume upload: handle_candidates_upload()
                                       • Move to opportunities/SO_XXXXXX/candidates/CAND_XXXXXX/
                                       • Invoke AgentCore with resume_key + job_analysis_key
                                       • Agent performs structured analysis → writes analysis.json
                                       • Lambda writes CandidateAnalysis (DynamoDB)
```

---

### 4. Chat (follow-up questions) → API Lambda → Bedrock AgentCore

```
UI sendChat(jobId, candidateId, query)
         │
         ▼
POST /api/chat ──► API Lambda ──► InvokeAgentRuntime
                                       │
                                       ▼
                              Bedrock AgentCore
                                       │
                                       ├── Payload: { query, job_description_id, candidate_id }
                                       ├── Agent uses JD + resume + analysis context
                                       └── Short-term memory: session per jobId_candidateId
```

---

## Bedrock AgentCore — Short-Term Memory

The agent uses **Bedrock AgentCore short-term memory** to keep conversation context per opportunity–candidate pair.

### Session ID = `opportunityId_candidateId`

```
session_id = MD5(job_description_id + "_" + candidate_id)[:16]
```

- Example: `SO_000001` + `CAND_000042` → `session_id = "a1b2c3d4e5f6..."`
- Each unique `(jobDescriptionId, candidateId)` has its own memory session.

### Event turns

| Component | Role |
|-----------|------|
| **MemoryManager** | Creates/retrieves memory resource (short-term, 30-day retention) |
| **MemorySessionManager** | Manages sessions for an actor |
| **MemorySession** | Holds event turns for one `session_id` |
| **MemoryHookProvider** | On agent init: load last 5 turns → add to system prompt |
| | On message added: store user/assistant turns via `add_turns()` |

### Flow

```
Chat request (jobId=SO_001, candidateId=CAND_042)
         │
         ▼
get_or_create_session(job_description_id=SO_001, candidate_id=CAND_042)
         │
         ├── session_id = MD5("SO_001_CAND_042")
         ├── Reuse existing session or create new one
         └── Return MemorySession for that session_id
         │
         ▼
MemoryHookProvider(session)
         │
         ├── on_agent_initialized: get_last_k_turns(5) → inject into system prompt
         └── on_message_added: add_turns(messages) → persist to memory
         │
         ▼
Agent responds with full conversation context
```

- All follow-up questions for the same `(opportunityId, candidateId)` use the same session.
- The agent can reference earlier Q&A in the same candidate’s chat.

---

## Component Summary

| AWS Component | Purpose |
|---------------|---------|
| **S3 (UI bucket)** | Static React app served via CloudFront |
| **CloudFront** | CDN, HTTPS, custom domain for UI |
| **S3 (Documents bucket)** | JD files, resumes, jd.json, analysis.json |
| **API Gateway** | HTTP API entry point for /api/* |
| **API Lambda** | Express middleware: presigned URLs, DynamoDB read, chat → AgentCore |
| **Trigger Lambda** | S3 event handler: JD/resume uploads → invoke AgentCore, update DynamoDB |
| **DynamoDB (JobAnalysis)** | One row per opportunity (jobDescriptionId, title, client, keywords, etc.) |
| **DynamoDB (CandidateAnalysis)** | One row per candidate (jobDescriptionId, candidateId, analysisS3Key) |
| **Bedrock AgentCore** | JD parsing, resume analysis, chat with short-term memory per jobId_candidateId |
