import { useRef, useState } from 'react';
import { getUploadUrl, uploadToS3 } from '../api/client';

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
}

export function UploadResume({ opportunityId, candidateId, onUploadComplete }: UploadResumeProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
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
    try {
      const { uploadUrl, key } = await getUploadUrl(
        opportunityId,
        file.name,
        file.type,
        candidateId
      );
      await uploadToS3(uploadUrl, file);
      setSuccess(`Uploaded: ${file.name}`);
      onUploadComplete?.(key);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Upload failed');
    } finally {
      setUploading(false);
    }
  };

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
            disabled={uploading}
            onClick={(e) => {
              e.stopPropagation();
              inputRef.current?.click();
            }}
          >
            {uploading ? 'Uploading…' : 'Choose file…'}
          </button>
        </div>
        {error && <div className="upload-error">{error}</div>}
        {success && <div className="upload-success">{success}</div>}
      </div>
    </div>
  );
}
