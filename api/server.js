/**
 * Resume Analyzer API — middleware for S3 and DynamoDB.
 * Uses AWS SDK v3 server-side; no credentials in the browser.
 *
 * Env: BUCKET_NAME, OPPORTUNITIES_TABLE (optional), REGION (optional)
 */

import express from 'express';
import cors from 'cors';
import { S3Client, PutObjectCommand, ListObjectsV2Command, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, ScanCommand, GetCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';

const app = express();
app.use(cors());
app.use(express.json());

const REGION = process.env.AWS_REGION || process.env.REGION || 'us-east-1';
const BUCKET_NAME = process.env.BUCKET_NAME || process.env.S3_BUCKET || 'amzn-s3-resume-analyzer-v2-bucket-agentcore-206409480438';
const OPPORTUNITIES_TABLE = process.env.OPPORTUNITIES_TABLE || process.env.DYNAMODB_TABLE || 'JobAnalysis-agentcore';
const CANDIDATE_TABLE = process.env.CANDIDATE_TABLE || 'CandidateAnalysis-agentcore';

const s3Client = new S3Client({ region: REGION });
const dynamoClient = new DynamoDBClient({ region: REGION });
const dynamo = DynamoDBDocumentClient.from(dynamoClient);

// ——— Mock data when DynamoDB table or env not set ———
const MOCK_OPPORTUNITIES = [
  { id: 'opp-1', title: 'Devops Architect', client: 'Rabo Bank', keywords: 'AWS, IaC, Docker, Ansible, CloudFormation', status: 'analyzed', candidatesCount: 4, topScore: 85, created: '10 Feb 2026' },
  { id: 'opp-2', title: 'AI Engineer', client: 'Rabo Bank', keywords: 'Python, LLM, RAG, Agentic AI, NLP', status: 'progress', candidatesCount: 3, topScore: 82, created: '12 Feb 2026' },
  { id: 'opp-3', title: 'Java Architect', client: 'ING', keywords: 'Java 17+, Spring Boot, Microservices, K8s', status: 'new', candidatesCount: 0, topScore: null, created: '14 Feb 2026' },
  { id: 'opp-4', title: 'Data Engineer', client: 'ABN AMRO', keywords: 'Spark, Databricks, Python, SQL, Azure', status: 'new', candidatesCount: 0, topScore: null, created: '15 Feb 2026' },
  { id: 'opp-5', title: 'Cloud Security Engineer', client: 'Rabo Bank', keywords: 'AWS, IAM, SIEM, Compliance, Terraform', status: 'closed', candidatesCount: 6, topScore: 91, created: '02 Feb 2026' },
];

const MOCK_ANALYSIS = {
  opportunityId: 'opp-1',
  opportunityTitle: 'Devops Architect — Rabo Bank',
  jd: {
    tags: [
      { label: 'AWS', years: '12 yrs' },
      { label: 'IaC', years: '5 yrs' },
      { label: 'AWS CodePipeline' },
      { label: 'Docker' },
      { label: 'Ansible' },
      { label: 'CloudFormation' },
    ],
    summary: 'Senior Devops Architect with 12+ years AWS experience. Must demonstrate expertise in Infrastructure as Code, CI/CD pipelines, container orchestration, and configuration management for banking-grade environments.',
  },
  candidates: [
    { id: 'c1', name: 'Ramesh Kumar', level: 'Senior', experienceYears: 14, overallScore: 85, coreScore: 90, domainScore: 85, softScore: 85, initials: 'RK' },
    { id: 'c2', name: 'Ishan Kishan', level: 'Senior', experienceYears: 11, overallScore: 80, coreScore: 80, domainScore: 65, softScore: 70, initials: 'IK' },
    { id: 'c3', name: 'Axar Patel', level: 'Senior', experienceYears: 10, overallScore: 75, coreScore: 80, domainScore: 50, softScore: 75, initials: 'AP' },
    { id: 'c4', name: 'Shubham Gill', level: 'Mid', experienceYears: 6, overallScore: 68, coreScore: 70, domainScore: 65, softScore: 75, initials: 'SG' },
  ],
  coreSkills: [
    { name: 'AWS', years: '12 yrs', level: 'Expert', status: 'pass' },
    { name: 'IaC', years: '5 yrs', level: 'Strong', status: 'pass' },
    { name: 'AWS CodePipeline', years: '6 yrs', level: 'Strong', status: 'pass' },
    { name: 'Docker', years: '10 yrs', level: 'Expert', status: 'pass' },
    { name: 'Ansible', years: '8 yrs', level: 'Expert', status: 'pass' },
    { name: 'CloudFormation', years: '5 yrs', level: 'Strong', status: 'pass' },
  ],
  domainSkills: [
    { skill: 'AI Solution Architecture', priority: 'High', level: 'Expert', evidence: 'Led multiple enterprise AI implementations' },
    { skill: 'Process Automation', priority: 'High', level: 'Expert', evidence: 'Business transformation projects' },
    { skill: 'Enterprise Integration', priority: 'Medium', level: 'Strong', evidence: 'Fortune 500 company experience' },
    { skill: 'Team Leadership', priority: 'Medium', level: 'Strong', evidence: 'Led multiple technical teams' },
  ],
  evidenceSnippets: [
    '34+ AI Models deployed across different functions in Organization',
    'Designing revolutionary Human-in-the-Loop frameworks enabling seamless collaboration',
    'Expert in Agentic AI, RAG implementation, and multi-agent orchestration systems',
    'Created algorithmic approaches to organizational structure optimization',
  ],
  gaps: [
    'Computer vision experience not explicitly demonstrated',
    'Specific NLP project details need verification',
    'Depth of experience with some required AI frameworks unclear',
  ],
  recommendation: 'Proceed with interview process focusing on computer vision and specific NLP experience validation. Candidate shows strong potential with extensive AI implementation experience.',
};

// ——— POST /api/opportunities/upload-jd (get presigned URL to upload a job description; no DynamoDB) ———
// Upload goes directly under opportunities/<filename>. Your trigger can process this path.
app.post('/api/opportunities/upload-jd', async (req, res) => {
  if (!BUCKET_NAME) {
    return res.status(500).json({ message: 'S3 bucket not configured (set BUCKET_NAME)' });
  }
  const { filename, contentType } = req.body || {};
  if (!filename) {
    return res.status(400).json({ message: 'filename is required' });
  }
  const safeName = String(filename).replace(/[^a-zA-Z0-9._-]/g, '_');
  const key = `opportunities/${safeName}`;
  try {
    const uploadUrl = await getSignedUrl(
      s3Client,
      new PutObjectCommand({
        Bucket: BUCKET_NAME,
        Key: key,
        ContentType: contentType || 'application/octet-stream',
      }),
      { expiresIn: 900 }
    );
    res.json({ uploadUrl, key, expiresIn: 900 });
  } catch (err) {
    console.error('Presign JD upload error:', err);
    res.status(500).json({ message: err.message || 'Failed to generate upload URL' });
  }
});

// ——— GET /api/opportunities ———
// DynamoDB schema: jobDescriptionId (pk), title, client, keywords[], s3Key, createdAt, status
app.get('/api/opportunities', async (req, res) => {
  try {
    if (!OPPORTUNITIES_TABLE) {
      return res.json(MOCK_OPPORTUNITIES);
    }
    const result = await dynamo.send(new ScanCommand({ TableName: OPPORTUNITIES_TABLE }));
    const items = (result.Items || []).map((item) => {
      const rawStatus = (item.status ?? 'new').toString();
      const status = rawStatus.toLowerCase();
      const keywords = item.keywords;
      const keywordsDisplay = Array.isArray(keywords)
        ? keywords.join(', ')
        : keywords != null ? String(keywords) : '';
      const createdAt = item.createdAt ?? item.created;
      const createdStr = createdAt
        ? (typeof createdAt === 'string' ? createdAt.slice(0, 10) : '—')
        : '—';
      return {
        id: item.jobDescriptionId ?? item.id ?? item.opportunityId,
        title: item.title ?? item.name ?? 'N/A',
        client: item.client ?? 'N/A',
        keywords: keywordsDisplay,
        s3Key: item.s3Key,
        status: status === 'active' ? 'active' : (status || 'new'),
        candidatesCount: Number(item.candidatesCount ?? item.candidates ?? 0),
        topScore: item.topScore != null ? Number(item.topScore) : null,
        created: createdStr,
      };
    });
    res.json(items.length ? items : MOCK_OPPORTUNITIES);
  } catch (err) {
    console.error('DynamoDB scan error:', err);
    res.json(MOCK_OPPORTUNITIES);
  }
});

// Parse s3://bucket/key to { bucket, key }
function parseS3Uri(uri) {
  const m = String(uri || '').match(/^s3:\/\/([^/]+)\/(.+)$/);
  return m ? { bucket: m[1], key: m[2] } : null;
}

// ——— GET /api/opportunities/:id/analysis ———
// 1. Get JD from JobAnalysis; 2. Query ranked candidates from CandidateAnalysis;
// 3. Fetch each candidate's analysis JSON from S3 (analysisS3Key); 4. Map to UI format.
app.get('/api/opportunities/:id/analysis', async (req, res) => {
  const { id } = req.params;
  console.log('[analysis] opportunity id:', id);
  try {
    if (!OPPORTUNITIES_TABLE) {
      const mock = { ...MOCK_ANALYSIS, opportunityId: id, opportunityTitle: `Opportunity ${id}` };
      return res.json(mock);
    }

    // 1. Get job from JobAnalysis
    const jobResult = await dynamo.send(new GetCommand({
      TableName: OPPORTUNITIES_TABLE,
      Key: { jobDescriptionId: id },
    }));
    const jobItem = jobResult.Item;
    const keywordsRaw = jobItem?.keywords;
    const jdTags = Array.isArray(keywordsRaw)
      ? keywordsRaw.map((k) => (typeof k === 'string' ? { label: k } : { label: k?.label ?? String(k), years: k?.years }))
      : (jobItem?.jd?.tags ?? MOCK_ANALYSIS.jd.tags);
    const jd = {
      tags: jdTags ?? [],
      summary: jobItem?.summary ?? jobItem?.jd?.summary ?? MOCK_ANALYSIS.jd.summary ?? '',
    };
    const opportunityTitle = jobItem?.title
      ? `${jobItem.title}${jobItem.client ? ` — ${jobItem.client}` : ''}`
      : id;

    // 2. Query ranked candidates from CandidateAnalysis
    const candidates = [];
    if (CANDIDATE_TABLE) {
      const queryResult = await dynamo.send(new QueryCommand({
        TableName: CANDIDATE_TABLE,
        KeyConditionExpression: 'jobDescriptionId = :jid',
        ExpressionAttributeValues: { ':jid': id },
      }));
      const candidateRows = queryResult.Items ?? [];

      for (const row of candidateRows) {
        const s3Uri = row.analysisS3Key ?? row.s3Key;
        if (!s3Uri) {
          candidates.push({
            id: row.candidateId,
            name: row.candidateName ?? row.candidateId,
            level: '',
            experienceYears: 0,
            overallScore: 0,
            coreScore: 0,
            domainScore: 0,
            softScore: 0,
            initials: (row.candidateName ?? row.candidateId ?? '?').slice(0, 2).toUpperCase(),
            coreSkills: [],
            domainSkills: [],
            evidenceSnippets: [],
            gaps: [],
            recommendation: '',
          });
          continue;
        }

        const parsed = parseS3Uri(s3Uri);
        const bucket = parsed?.bucket ?? BUCKET_NAME;
        const key = parsed?.key;

        let analysis = null;
        if (key && BUCKET_NAME) {
          try {
            const obj = await s3Client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
            const body = await obj.Body?.transformToString?.() ?? '';
            analysis = JSON.parse(body || '{}');
          } catch (e) {
            console.warn(`[analysis] Failed to fetch S3 ${bucket}/${key}:`, e.message);
          }
        }

        const c = analysis?.candidate ?? {};
        const mapped = {
          id: c.id ?? row.candidateId,
          name: c.name ?? row.candidateName ?? row.candidateId ?? '',
          level: c.level ?? '',
          experienceYears: c.experienceYears ?? 0,
          overallScore: c.overallScore ?? 0,
          coreScore: c.coreScore ?? 0,
          domainScore: c.domainScore ?? 0,
          softScore: c.softScore ?? 0,
          initials: c.initials ?? (c.name ?? row.candidateName ?? '?').slice(0, 2).toUpperCase(),
          coreSkills: analysis?.coreSkills ?? [],
          domainSkills: analysis?.domainSkills ?? [],
          evidenceSnippets: analysis?.evidenceSnippets ?? [],
          gaps: analysis?.gaps ?? [],
          recommendation: analysis?.recommendation ?? '',
        };
        candidates.push(mapped);
      }

      // Sort by overallScore descending (ranked)
      candidates.sort((a, b) => (b.overallScore ?? 0) - (a.overallScore ?? 0));
    }

    const payload = {
      opportunityId: id,
      opportunityTitle,
      jd,
      candidates: candidates.length ? candidates : (jobItem?.candidates ?? MOCK_ANALYSIS.candidates),
      coreSkills: [],  // Per-candidate; use selected candidate's
      domainSkills: [],
      evidenceSnippets: [],
      gaps: [],
      recommendation: '',
    };
    res.json(payload);
  } catch (err) {
    console.error('[analysis] Error:', err);
    res.json({ ...MOCK_ANALYSIS, opportunityId: id, opportunityTitle: `Opportunity ${id}` });
  }
});

// S3 folder structure (see create_s3_folders.py):
//   opportunities/
//   └── SO_ID/                    (opportunityId)
//       ├── jd/                   (job description files)
//       ├── candidates/
//       │   └── candidate_id/     (resumes per candidate)
//       └── analysis/

// ——— POST /api/upload-url (presigned URL for S3 upload) ———
app.post('/api/upload-url', async (req, res) => {
  if (!BUCKET_NAME) {
    return res.status(500).json({ message: 'S3 bucket not configured (set BUCKET_NAME)' });
  }
  const { opportunityId, filename, contentType } = req.body || {};
  if (!opportunityId || !filename) {
    return res.status(400).json({ message: 'opportunityId and filename required' });
  }
  const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, '_');
  // Directly under opportunities/<jobId>/candidates/ (no subfolder)
  const key = `opportunities/${opportunityId}/candidates/${safeName}`;
  try {
    const uploadUrl = await getSignedUrl(
      s3Client,
      new PutObjectCommand({
        Bucket: BUCKET_NAME,
        Key: key,
        ContentType: contentType || 'application/octet-stream',
      }),
      { expiresIn: 900 }
    );
    res.json({ uploadUrl, key, expiresIn: 900 });
  } catch (err) {
    console.error('Presign error:', err);
    res.status(500).json({ message: err.message || 'Failed to generate upload URL' });
  }
});

// ——— GET /api/files?prefix=... (list S3 objects) ———
// Use prefixes aligned to folder structure, e.g.:
//   opportunities/<opportunityId>/jd/
//   opportunities/<opportunityId>/candidates/
//   opportunities/<opportunityId>/candidates/<candidateId>/
app.get('/api/files', async (req, res) => {
  if (!BUCKET_NAME) {
    return res.status(500).json({ message: 'S3 bucket not configured (set BUCKET_NAME)' });
  }
  const prefix = req.query.prefix || '';
  try {
    const result = await s3Client.send(new ListObjectsV2Command({
      Bucket: BUCKET_NAME,
      Prefix: String(prefix),
      MaxKeys: 100,
    }));
    const list = (result.Contents || []).map((o) => ({
      key: o.Key,
      size: o.Size ?? 0,
      lastModified: o.LastModified ? o.LastModified.toISOString() : '',
    }));
    res.json(list);
  } catch (err) {
    console.error('S3 list error:', err);
    res.status(500).json({ message: err.message || 'Failed to list files' });
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Resume Analyzer API on http://localhost:${PORT}`);
  console.log('  GET  /api/opportunities');
  console.log('  POST /api/opportunities/upload-jd (upload JD file to S3; no DynamoDB)');
  console.log('  GET  /api/opportunities/:id/analysis');
  console.log('  POST /api/upload-url');
  console.log('  GET  /api/files?prefix=...');
  if (!BUCKET_NAME) console.log('  (S3: set BUCKET_NAME for upload/list)');
  if (!OPPORTUNITIES_TABLE) console.log('  (DynamoDB: using mock data; set OPPORTUNITIES_TABLE for real data)');
  if (!CANDIDATE_TABLE) console.log('  (DynamoDB: set CANDIDATE_TABLE for ranked candidates from CandidateAnalysis)');
});
