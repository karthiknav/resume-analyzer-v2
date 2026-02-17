/** Types for Resume Analyzer API (DynamoDB + S3) */

export type OpportunityStatus = 'new' | 'active' | 'progress' | 'analyzed' | 'closed';

export interface Opportunity {
  id: string;
  title: string;
  client: string;
  keywords?: string;
  s3Key?: string;
  status: OpportunityStatus;
  candidatesCount: number;
  topScore?: number;
  created: string;
}

export interface Candidate {
  id: string;
  name: string;
  level: string;
  experienceYears: number;
  overallScore: number;
  coreScore: number;
  domainScore: number;
  softScore: number;
  initials: string;
}

export interface JdRequirements {
  tags: Array<{ label: string; years?: string }>;
  summary: string;
}

export interface AnalysisDetail {
  opportunityId: string;
  opportunityTitle: string;
  jd: JdRequirements;
  candidates: Candidate[];
  selectedCandidate?: Candidate;
  coreSkills: Array<{ name: string; years: string; level: string; status: 'pass' | 'partial' | 'fail' }>;
  domainSkills: Array<{ skill: string; priority: string; level: string; evidence: string }>;
  evidenceSnippets: string[];
  gaps: string[];
  recommendation: string;
}

export interface UploadUrlResponse {
  uploadUrl: string;
  key: string;
  expiresIn: number;
}

export interface S3ObjectInfo {
  key: string;
  size: number;
  lastModified: string;
  url?: string;
}
