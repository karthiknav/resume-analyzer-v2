/**
 * API client for Resume Analyzer backend.
 * All AWS operations (S3 upload, DynamoDB read) go through this API — no AWS credentials in the browser.
 */

import type {
  Opportunity,
  AnalysisDetail,
  UploadUrlResponse,
  S3ObjectInfo,
} from './types';

const API_BASE = '/api';

async function request<T>(
  path: string,
  options?: RequestInit
): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ message: res.statusText }));
    throw new Error((err as { message?: string }).message || `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

/** List opportunities from DynamoDB (or mock). */
export async function listOpportunities(): Promise<Opportunity[]> {
  return request<Opportunity[]>('/opportunities');
}

/** Get analysis detail for an opportunity (DynamoDB + S3). */
export async function getAnalysis(opportunityId: string): Promise<AnalysisDetail> {
  return request<AnalysisDetail>(`/opportunities/${opportunityId}/analysis`);
}

/** Get presigned URL for uploading a resume to S3. */
export async function getUploadUrl(
  opportunityId: string,
  filename: string,
  contentType: string
): Promise<UploadUrlResponse> {
  return request<UploadUrlResponse>('/upload-url', {
    method: 'POST',
    body: JSON.stringify({ opportunityId, filename, contentType }),
  });
}

/** Upload file to S3 using presigned URL (from backend). */
export async function uploadToS3(
  uploadUrl: string,
  file: File
): Promise<void> {
  const res = await fetch(uploadUrl, {
    method: 'PUT',
    body: file,
    headers: {
      'Content-Type': file.type,
    },
  });
  if (!res.ok) {
    throw new Error(`Upload failed: ${res.statusText}`);
  }
}

/** List files in S3 prefix (e.g. for an opportunity). */
export async function listS3Files(prefix: string): Promise<S3ObjectInfo[]> {
  return request<S3ObjectInfo[]>(`/files?prefix=${encodeURIComponent(prefix)}`);
}
