import { useRef, useState, useCallback } from 'react';
import { getUploadUrl, uploadToS3, getAnalysis } from '../api/client';
import { usePolling } from '../hooks/usePolling';
import type { Candidate } from '../api/types';

const MAX_SIZE_MB = 10;
const ALLOWED_TYPES = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
];

interface UploadResumeProps {
  opportunityId: string;
  /** When set, file is stored under opportunities/<id>/candidates/<candidateId>/<file> */
  candidateId?: string;
  onUploadComplete?: (key: string) => void;
  /** Callback when a new candidate analysis is ready */
  onCandidateReady?: (candidate: Candidate) => void;
  /** Callback when upload is done and analysis has started (so parent can show "in progress" row) */
  onProcessingStart?: (fileName: string) => void;
  /** Callback when processing ends (success or timeout) so parent can clear "in progress" row */
  onProcessingEnd?: () => void;
  /** Current list of candidates to check against */
  existingCandidateIds?: string[];
}

export function UploadResume({ 
  opportunityId, 
  candidateId, 
  onUploadComplete,
  onCandidateReady,
  onProcessingStart,
  onProcessingEnd,
  existingCandidateIds = [],
}: UploadResumeProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  /** Snapshot of candidate ids when we started processing; keeps polling from resetting when parent re-renders */
  const idsAtStartRef = useRef<string[]>([]);
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const validate = (file: File): string | null => {
    if (file.size > MAX_SIZE_MB * 1024 * 1024) {
      return `File must be under ${MAX_SIZE_MB}MB`;
    }
    if (!ALLOWED_TYPES.includes(file.type)) {
      return 'Only PDF or DOCX allowed';
    }
    return null;
  };

  const doUpload = async (file: File) => {
    setError(null);
    setSuccess(null);
    const err = validate(file);
    if (err) {
      setError(err);
      return;
    }
    setUploading(true);
    setProcessing(false);

    try {
      // Step 1: Upload to S3
      const { uploadUrl, key } = await getUploadUrl(
        opportunityId,
        file.name,
        file.type,
        candidateId
      );
      await uploadToS3(uploadUrl, file);
      
      // Step 2: Show processing state; snapshot ids so polling uses a stable list
      idsAtStartRef.current = [...existingCandidateIds];
      setUploading(false);
      setProcessing(true);
      setSuccess(`File uploaded. Analyzing resume...`);
      onUploadComplete?.(key);
      onProcessingStart?.(file.name);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Upload failed');
      setUploading(false);
      setProcessing(false);
    }
  };

  const checkForNewCandidate = useCallback(async () => {
    try {
      const analysis = await getAnalysis(opportunityId);
      const currentCandidateIds = analysis.candidates?.map(c => c.id) || [];
      const existing = idsAtStartRef.current;
      const newCandidates = currentCandidateIds.filter(id => !existing.includes(id));
      if (newCandidates.length > 0) {
        const newCandidate = analysis.candidates?.find(c => c.id === newCandidates[0]);
        if (newCandidate) {
          onCandidateReady?.(newCandidate);
          return true;
        }
      }
      return false;
    } catch {
      return false;
    }
  }, [opportunityId, onCandidateReady]);

  usePolling({
    enabled: processing,
    checkFn: checkForNewCandidate,
    interval: 2000,
    maxAttempts: 30, // 60 seconds max
    onSuccess: () => {
      setProcessing(false);
      setSuccess(`Resume analyzed successfully!`);
      onProcessingEnd?.();
      // Clear success message after 3 seconds
      setTimeout(() => setSuccess(null), 3000);
    },
    onTimeout: () => {
      setProcessing(false);
      setSuccess(`Analysis is taking longer than expected. Results will appear when ready.`);
      onProcessingEnd?.();
      setTimeout(() => setSuccess(null), 5000);
    },
  });

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) doUpload(file);
  };

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) doUpload(file);
    e.target.value = '';
  };

  return (
    <div className="card">
      <div
        className="card-body upload-resume-card-body"
        style={{ textAlign: 'center', padding: 24 }}
        onClick={() => !uploading && inputRef.current?.click()}
      >
        <input
          ref={inputRef}
          type="file"
          accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
          onChange={onFileChange}
          disabled={uploading}
          style={{ display: 'none' }}
        />
        <div
          className={`upload-zone ${dragging ? 'dragging' : ''}`}
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
        >
          <div style={{ fontSize: 32, marginBottom: 8 }}>📎</div>
          <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 4 }}>
            Upload New Resume
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-tertiary)', marginBottom: 8 }}>
            PDF or DOCX • Max {MAX_SIZE_MB}MB
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginBottom: 12 }}>
            Saves to opportunities / this job / candidates
          </div>
          <button
            type="button"
            className="btn btn-primary btn-sm"
            disabled={uploading || processing}
            onClick={(e) => {
              e.stopPropagation();
              inputRef.current?.click();
            }}
          >
            {uploading ? 'Uploading…' : processing ? 'Processing…' : 'Choose file…'}
          </button>
        </div>
        {error && (
          <div className="upload-error" style={{ marginTop: 12 }}>
            {error}
          </div>
        )}
        {success && (
          <div 
            className="upload-success" 
            style={{ 
              marginTop: 12,
              display: 'flex',
              alignItems: 'center',
              gap: 8,
            }}
          >
            {processing && (
              <div className="spinner" style={{ 
                width: 14, 
                height: 14, 
                border: '2px solid currentColor',
                borderTopColor: 'transparent',
                borderRadius: '50%',
                animation: 'spin 0.8s linear infinite',
              }} />
            )}
            {success}
          </div>
        )}
      </div>
    </div>
  );
}
