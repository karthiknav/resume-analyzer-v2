# Resume Analyzer — UI Flow

End-to-end flow from uploading a job opportunity through resume analysis and follow-up questions.

---

## UI Flow Summary (Arrow Diagram)

```
  Opportunities Screen
         │
         │  + New Opportunity → pick JD (PDF/DOCX)
         │         │
         │         ▼
         │  getUploadJdUrl() ──► presigned URL ──► upload to S3
         │         │
         │         │  [S3 trigger] Lambda invokes agent for Job Analysis → JobAnalysis (DynamoDB)
         │         │
         │  ◄──────┘
         │
         │  listOpportunities() ──► GET /opportunities ──► show table
         │
         │  click row / "View" on opportunity
         │         │
         │         ▼
         └────────► Analysis Screen
                         │
                         │  getAnalysis(id) ──► JD + ranked candidates + analysis from S3
                         │
                         │  select candidate ──► show profile, scores, skills, gaps, recommendation
                         │
                         │  Upload New Resume (drag/drop or choose)
                         │         │
                         │         ▼
                         │  getUploadUrl() ──► presigned URL ──► upload to S3
                         │         │
                         │         │  [S3 trigger] Lambda invokes agent for Resume Analysis
                         │         │              ──► analysis.json → CandidateAnalysis (DynamoDB)
                         │         │
                         │  ◄──────┘  refresh & rerank candidates
                         │
                         │  type question in chat ──► sendChat(jobId, candidateId, query)
                         │         │
                         │         ▼
                         │  POST /chat ──► Bedrock AgentCore ──► reply
                         │
                         │  select / reject candidate ──► close the opportunity
                         │
                         └────────────► back to Opportunities
```

---

## Overview Diagram

```
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│                                    UI (React + Vite)                                      │
└─────────────────────────────────────────────────────────────────────────────────────────┘
    │                                    │                                    │
    │ 1. Upload JD                       │ 2. View & Open                    │ 3. Upload Resume
    │ 4. Chat (follow-up)                │    Analysis                        │    + Chat
    ▼                                    ▼                                    ▼
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│                              API (Express / Lambda)                                        │
│  POST /api/opportunities/upload-jd   GET /api/opportunities   GET /api/opportunities/:id/analysis │
│  POST /api/upload-url                POST /api/chat                                         │
└─────────────────────────────────────────────────────────────────────────────────────────┘
    │                                    │                                    │
    ▼                                    ▼                                    ▼
┌─────────────┐                  ┌──────────────┐                    ┌──────────────────┐
│     S3      │ ──trigger──►     │ Lambda       │ ──invoke──►        │ Bedrock          │
│  (uploads)  │                  │ (parse JD,   │                    │ AgentCore        │
│             │                  │  analyze     │                    │ (resume analyzer)│
│             │                  │  resumes)    │                    │                  │
└─────────────┘                  └──────────────┘                    └──────────────────┘
    │                                    │
    │                                    ▼
    │                            ┌──────────────┐
    └──────────────────────────► │  DynamoDB    │
                                 │  JobAnalysis │
                                 │  CandidateAnalysis │
                                 └──────────────┘
```

---

## Step-by-Step Flow

### 1. Upload Job Opportunity (Job Description)

| Step | Component | Action |
|------|-----------|--------|
| 1.1 | **Opportunities** screen | User clicks **+ New Opportunity** and selects a JD file (PDF or DOCX, max 10MB) |
| 1.2 | UI → API | `POST /api/opportunities/upload-jd` with `{ filename, contentType }` |
| 1.3 | API | Returns presigned S3 URL for `opportunities/<filename>` |
| 1.4 | UI | Uploads file directly to S3 using presigned PUT URL |
| 1.5 | S3 | Object created at `opportunities/job_desc.pdf` (or similar) triggers Lambda |
| 1.6 | **Lambda** | `handle_root_jd_upload`: |
| | | • Assigns unique ID `SO_XXXXXX` (e.g. `SO_000001`) |
| | | • Moves file to `opportunities/SO_XXXXXX/jd/<filename>` |
| | | • Invokes Bedrock AgentCore to parse JD and produce `jd.json` |
| | | • Writes JobAnalysis DynamoDB: `jobDescriptionId`, `title`, `client`, `keywords`, `summary` |
| 1.7 | UI | Shows success message; refreshes opportunity list |

**S3 path after step 1:**  
`opportunities/SO_000001/jd/job_description.pdf`  
`opportunities/SO_000001/jd/jd.json` (created by agent)

---

### 2. List Opportunities & Open Analysis

| Step | Component | Action |
|------|-----------|--------|
| 2.1 | **Opportunities** screen | `GET /api/opportunities` loads list from JobAnalysis DynamoDB |
| 2.2 | UI | Displays table: title, client, status, candidates count, top score |
| 2.3 | User | Clicks a row or **View →** to open that opportunity’s analysis |
| 2.4 | **Analysis** screen | `GET /api/opportunities/:id/analysis` loads: |
| | | • Job from JobAnalysis (JD tags, summary) |
| | | • Candidates from CandidateAnalysis (ranked by score) |
| | | • Per-candidate analysis JSON from S3 (via `analysisS3Key`) |

**Data shown:** JD requirements, ranked candidates with scores, core/domain skills, evidence, gaps, recommendation.

---

### 3. Upload Resume & Automatic Analysis

| Step | Component | Action |
|------|-----------|--------|
| 3.1 | **Analysis** screen | User opens **Upload New Resume** (or drags file into the zone) |
| 3.2 | User | Selects PDF or DOCX resume (max 10MB) |
| 3.3 | UI → API | `POST /api/upload-url` with `{ opportunityId, filename, contentType }` |
| 3.4 | API | Returns presigned URL for `opportunities/<opportunityId>/candidates/<filename>` |
| 3.5 | UI | Uploads file directly to S3 via presigned PUT |
| 3.6 | S3 | Object at `opportunities/SO_000001/candidates/resume.pdf` triggers Lambda |
| 3.7 | **Lambda** | `handle_candidates_upload`: |
| | | • Assigns unique candidate ID `CAND_XXXXXX` |
| | | • Moves file to `opportunities/SO_000001/candidates/CAND_000001/resume.pdf` |
| | | • Invokes Bedrock AgentCore with JD + resume to analyze match |
| | | • Waits for `analysis.json` in `opportunities/SO_000001/candidates/CAND_000001/` |
| | | • Writes CandidateAnalysis DynamoDB: `jobDescriptionId`, `candidateId`, `analysisS3Key` |
| 3.8 | User | Refreshes or navigates back/forth to see the new candidate in the ranked list |

**S3 path after step 3:**  
`opportunities/SO_000001/candidates/CAND_000001/resume.pdf`  
`opportunities/SO_000001/candidates/CAND_000001/analysis.json` (created by agent)

---

### 4. Follow-Up Questions (Chat with Resume Context)

| Step | Component | Action |
|------|-----------|--------|
| 4.1 | **Analysis** screen | User selects a candidate in the ranked list |
| 4.2 | UI | Renders that candidate’s profile: scores, core/domain skills, evidence, gaps |
| 4.3 | User | Types a question in the chat input (e.g. *"What are this candidate’s main strengths for this role?"*) |
| 4.4 | UI → API | `POST /api/chat` with `{ jobDescriptionId, candidateId, query }` |
| 4.5 | API | Looks up candidate in CandidateAnalysis; invokes Bedrock AgentCore with: |
| | | • `job_description_id`, `candidate_id`, `query` |
| | | Agent uses JD + resume + analysis to answer |
| 4.6 | API | Returns `{ reply }` |
| 4.7 | UI | Appends user message and agent reply to the chat |

**Use case:** Ask clarifying questions about the candidate, JD fit, or recommendations.

---

## API Endpoints Summary

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/api/opportunities/upload-jd` | Get presigned URL to upload JD (creates new opportunity via Lambda) |
| GET | `/api/opportunities` | List opportunities from JobAnalysis |
| GET | `/api/opportunities/:id/analysis` | Get JD + ranked candidates + analysis from S3 |
| POST | `/api/upload-url` | Get presigned URL to upload resume (triggers analysis via Lambda) |
| POST | `/api/chat` | Ask follow-up questions about a candidate (AgentCore) |

---

## S3 Folder Structure (after processing)

```
s3://bucket/
└── opportunities/
    ├── sample.pdf                    ← Root JD upload (then moved by Lambda)
    └── SO_000001/                    ← Opportunity ID
        ├── jd/
        │   ├── job_description.pdf   ← Original JD file
        │   └── jd.json               ← Parsed JD (created by agent)
        └── candidates/
            ├── resume.pdf            ← Direct upload (then moved by Lambda)
            └── CAND_000001/          ← Candidate ID
                ├── resume.pdf        ← Moved resume
                └── analysis.json     ← Analysis output (created by agent)
```

---

## DynamoDB Tables

| Table | Key | Purpose |
|-------|-----|---------|
| **JobAnalysis** | `jobDescriptionId` (PK) | One row per opportunity: title, client, keywords, summary, s3Key |
| **CandidateAnalysis** | `jobDescriptionId` (PK), `candidateId` (SK) | One row per candidate: analysisS3Key, candidateName, status |
| **Counters** | `counterId` | Sequences for `SO_XXXXXX` and `CAND_XXXXXX` IDs |

---

## UI Screens

| Screen | Main components | Actions |
|--------|-----------------|---------|
| **Opportunities** | Job list, filters, stats | Upload JD, open analysis |
| **Analysis** | JD requirements, ranked candidates, candidate profile, chat | Upload resume, select candidate, chat |
