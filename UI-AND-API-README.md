# Resume Analyzer — Rich UI & API

This folder contains a **React (TypeScript)** UI and a **Node/Express** middleware API that together replace the mock HTML and enable real AWS operations (S3 upload, DynamoDB and S3 reads).

## Can the UI call AWS SDK directly?

**Technically yes, but it’s not recommended for production.**

- **Browser calling AWS directly**  
  You can use the AWS SDK for JavaScript in the browser with **Cognito Identity Pools** (no long‑lived credentials in the frontend). You’d still need CORS on S3/DynamoDB and IAM policies for the Cognito identity. This is more complex and less flexible for fine‑grained control and auditing.

- **Recommended: middleware (this repo)**  
  The **UI talks only to your API**. The API runs with IAM role or env credentials and uses the AWS SDK to:
  - Issue **presigned URLs** for S3 uploads (browser uploads directly to S3 with no credentials).
  - **Read from DynamoDB** and optionally S3, and return JSON to the UI.

So: **the UI is capable of displaying data from DynamoDB and S3 and of uploading to S3, but that should go through the middleware** (as implemented here), not by calling the AWS SDK from the browser.

## Architecture

```
┌─────────────────┐         ┌──────────────────┐         ┌─────────────────┐
│   React UI      │  HTTP   │  Express API      │  AWS    │  S3 / DynamoDB  │
│   (Vite)        │ ──────► │  (middleware)     │ ──────► │                 │
│   Port 5173     │         │  Port 3001        │  SDK   │                 │
└─────────────────┘         └──────────────────┘         └─────────────────┘
       │                              │
       │  /api/* proxied to :3001     │  Uses AWS SDK:
       │                              │  - S3: putObject (presign), listObjectsV2
       └──────────────────────────────│  - DynamoDB: scan, get
                                      └──────────────────────────────────────
```

- **UI**: React + TypeScript + Vite. Lists opportunities, shows analysis, **upload resume** (via API presigned URL → S3).
- **API**: Express. Endpoints for opportunities, analysis, upload URL, and file list. Uses **AWS SDK** (S3, DynamoDB) server‑side.

## Project layout

- **`ui/`** — React app (Vite, TypeScript).
- **`api/`** — Express server using AWS SDK for S3 and DynamoDB.

## Run locally

### 1. API (middleware)

```bash
cd api
npm install
# Optional: set AWS credentials (or use IAM role / env in production)
export BUCKET_NAME=your-bucket-name          # S3 bucket for resumes
export OPPORTUNITIES_TABLE=your-table-name    # DynamoDB table (optional; mock used if unset)
npm run dev
```

API runs at **http://localhost:3001**. Without `BUCKET_NAME` / `OPPORTUNITIES_TABLE`, upload and DynamoDB are disabled or mocked.

### 2. UI

```bash
cd ui
npm install
npm run dev
```

UI runs at **http://localhost:5173**. Vite proxies `/api` to `http://localhost:3001`, so the UI can call the API without CORS issues.

### 3. Using your CloudFormation bucket

If you deploy `template-infrastructure.yaml`, the stack outputs the document bucket name. Use that as `BUCKET_NAME`:

```bash
export BUCKET_NAME=amzn-s3-resume-analyzer-bucket-agentcore-<ACCOUNT_ID>
```

Ensure the process running the API has IAM permissions for that bucket (e.g. `s3:PutObject`, `s3:ListBucket`, `s3:GetObject`).

## API endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/opportunities` | List opportunities (DynamoDB or mock). |
| GET | `/api/opportunities/:id/analysis` | Analysis for one opportunity (DynamoDB or mock). |
| POST | `/api/upload-url` | Body: `{ opportunityId, filename, contentType }`. Returns presigned S3 upload URL. |
| GET | `/api/files?prefix=...` | List S3 object keys under prefix. |

## Environment (API)

| Variable | Description |
|----------|-------------|
| `BUCKET_NAME` or `S3_BUCKET` | S3 bucket for resume uploads and file list. |
| `OPPORTUNITIES_TABLE` or `DYNAMODB_TABLE` | DynamoDB table for opportunities/analysis. If unset, mock data is returned. |
| `AWS_REGION` or `REGION` | AWS region (default `us-east-1`). |
| `PORT` | API port (default `3001`). |

## Debugging

- **React**: Use React DevTools and Vite’s fast refresh. Logs and network tab show API calls to `/api/*`.
- **API**: Logs are on the terminal; add more `console.log` or a logger as needed. Use breakpoints in Node (e.g. VS Code) on `api/server.js`.

## Summary

- **Rich UI**: React + TypeScript in `ui/`, matching the original mock layout and behavior, with S3 upload and DynamoDB/S3-backed display.
- **AWS access**: Done **only in the middleware** via the AWS SDK (S3 presign + list, DynamoDB scan/get). The UI does not use the AWS SDK; it only calls the API.
- **Easy to debug**: Run API and UI separately, use browser DevTools and Node debugger as above.
