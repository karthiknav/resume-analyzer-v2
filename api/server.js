/**
 * Resume Analyzer API — middleware for S3 and DynamoDB.
 * Uses AWS SDK server-side; no credentials in the browser.
 *
 * Env: BUCKET_NAME, OPPORTUNITIES_TABLE (optional), REGION (optional)
 */

import express from 'express';
import cors from 'cors';
import pkg from 'aws-sdk';
const { S3, DynamoDB } = pkg;

const app = express();
app.use(cors());
app.use(express.json());

const REGION = process.env.AWS_REGION || process.env.REGION || 'us-east-1';
const BUCKET_NAME = process.env.BUCKET_NAME || process.env.S3_BUCKET;
const OPPORTUNITIES_TABLE = process.env.OPPORTUNITIES_TABLE || process.env.DYNAMODB_TABLE;

const s3 = new S3({ region: REGION });
const dynamo = new DynamoDB.DocumentClient({ region: REGION });

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

// ——— GET /api/opportunities ———
app.get('/api/opportunities', async (req, res) => {
  try {
    if (!OPPORTUNITIES_TABLE) {
      return res.json(MOCK_OPPORTUNITIES);
    }
    const result = await dynamo.scan({ TableName: OPPORTUNITIES_TABLE }).promise();
    const items = (result.Items || []).map((item) => ({
      id: item.id ?? item.opportunityId,
      title: item.title ?? item.name,
      client: item.client,
      keywords: item.keywords,
      status: item.status ?? 'new',
      candidatesCount: Number(item.candidatesCount ?? item.candidates ?? 0),
      topScore: item.topScore != null ? Number(item.topScore) : null,
      created: item.created ?? item.createdAt ?? '—',
    }));
    res.json(items.length ? items : MOCK_OPPORTUNITIES);
  } catch (err) {
    console.error('DynamoDB scan error:', err);
    res.json(MOCK_OPPORTUNITIES);
  }
});

// ——— GET /api/opportunities/:id/analysis ———
app.get('/api/opportunities/:id/analysis', async (req, res) => {
  const { id } = req.params;
  try {
    if (!OPPORTUNITIES_TABLE) {
      const mock = { ...MOCK_ANALYSIS, opportunityId: id, opportunityTitle: `Opportunity ${id}` };
      return res.json(mock);
    }
    const result = await dynamo.get({
      TableName: OPPORTUNITIES_TABLE,
      Key: { id },
    }).promise();
    if (!result.Item) {
      return res.json({ ...MOCK_ANALYSIS, opportunityId: id, opportunityTitle: `Opportunity ${id}` });
    }
    const item = result.Item;
    res.json({
      opportunityId: id,
      opportunityTitle: item.title ? `${item.title} — ${item.client || ''}` : id,
      jd: item.jd ?? MOCK_ANALYSIS.jd,
      candidates: item.candidates ?? MOCK_ANALYSIS.candidates,
      coreSkills: item.coreSkills ?? MOCK_ANALYSIS.coreSkills,
      domainSkills: item.domainSkills ?? MOCK_ANALYSIS.domainSkills,
      evidenceSnippets: item.evidenceSnippets ?? MOCK_ANALYSIS.evidenceSnippets,
      gaps: item.gaps ?? MOCK_ANALYSIS.gaps,
      recommendation: item.recommendation ?? MOCK_ANALYSIS.recommendation,
    });
  } catch (err) {
    console.error('DynamoDB get error:', err);
    res.json({ ...MOCK_ANALYSIS, opportunityId: id, opportunityTitle: `Opportunity ${id}` });
  }
});

// ——— POST /api/upload-url (presigned URL for S3 upload) ———
app.post('/api/upload-url', async (req, res) => {
  if (!BUCKET_NAME) {
    return res.status(500).json({ message: 'S3 bucket not configured (set BUCKET_NAME)' });
  }
  const { opportunityId, filename, contentType } = req.body || {};
  if (!opportunityId || !filename) {
    return res.status(400).json({ message: 'opportunityId and filename required' });
  }
  const key = `opportunities/${opportunityId}/resumes/${Date.now()}-${filename.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
  try {
    const uploadUrl = s3.getSignedUrl('putObject', {
      Bucket: BUCKET_NAME,
      Key: key,
      ContentType: contentType || 'application/octet-stream',
      Expires: 900,
    });
    res.json({ uploadUrl, key, expiresIn: 900 });
  } catch (err) {
    console.error('Presign error:', err);
    res.status(500).json({ message: err.message || 'Failed to generate upload URL' });
  }
});

// ——— GET /api/files?prefix=... (list S3 objects) ———
app.get('/api/files', async (req, res) => {
  if (!BUCKET_NAME) {
    return res.status(500).json({ message: 'S3 bucket not configured (set BUCKET_NAME)' });
  }
  const prefix = req.query.prefix || '';
  try {
    const result = await s3.listObjectsV2({
      Bucket: BUCKET_NAME,
      Prefix: String(prefix),
      MaxKeys: 100,
    }).promise();
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
  console.log('  GET  /api/opportunities/:id/analysis');
  console.log('  POST /api/upload-url');
  console.log('  GET  /api/files?prefix=...');
  if (!BUCKET_NAME) console.log('  (S3: set BUCKET_NAME for upload/list)');
  if (!OPPORTUNITIES_TABLE) console.log('  (DynamoDB: using mock data; set OPPORTUNITIES_TABLE for real data)');
});
