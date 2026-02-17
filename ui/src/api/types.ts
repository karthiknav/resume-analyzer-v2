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

export interface CoreSkill {
  name: string;
  years?: string;
  level: string;
  status: 'pass' | 'partial' | 'fail';
}

export interface DomainSkill {
  skill: string;
  priority: string;
  level: string;
  evidence: string;
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
  location?: string;
  /** Per-candidate analysis from S3 (analysis.json) */
  coreSkills?: CoreSkill[];
  domainSkills?: DomainSkill[];
  evidenceSnippets?: string[];
  gaps?: string[];
  recommendation?: string;
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
  /** Legacy: use selected candidate's coreSkills when available */
  coreSkills?: CoreSkill[];
  domainSkills?: DomainSkill[];
  evidenceSnippets?: string[];
  gaps?: string[];
  recommendation?: string;
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
