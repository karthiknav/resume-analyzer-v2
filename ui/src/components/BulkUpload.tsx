import { useRef, useState, useCallback } from 'react';
import { getUploadUrl, uploadToS3 } from '../api/client';

const MAX_SIZE_MB = 10;
const ALLOWED_TYPES = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
];

function validateFile(file: File): string | null {
  if (file.size > MAX_SIZE_MB * 1024 * 1024) {
    return `Over ${MAX_SIZE_MB}MB`;
  }
  if (!ALLOWED_TYPES.includes(file.type)) {
    return 'Not PDF/DOCX';
  }
  return null;
}

/** Ensure a unique display/upload name when multiple files share the same name */
function uniqueFilename(name: string, existing: Set<string>): string {
  const base = name.replace(/\.[^/.]+$/, '');
  const ext = name.includes('.') ? name.slice(name.lastIndexOf('.')) : '';
  let candidate = name;
  let n = 1;
  while (existing.has(candidate)) {
    n += 1;
    candidate = `${base} (${n})${ext}`;
  }
  existing.add(candidate);
  return candidate;
}

export type BulkUploadItem = {
  id: string;
  file: File;
  status: 'pending' | 'uploading' | 'uploaded' | 'error';
  error?: string;
  /** Name used for presigned URL (unique) */
  uploadName: string;
};

interface BulkUploadProps {
  opportunityId: string;
  onBulkUploadComplete: (successCount: number) => void;
  /** When parent is polling for new candidates after bulk upload */
  bulkPendingCount: number;
  bulkStartedAtCount: number;
  currentCandidateCount: number;
}

export function BulkUpload({
  opportunityId,
  onBulkUploadComplete,
  bulkPendingCount,
  bulkStartedAtCount,
  currentCandidateCount,
}: BulkUploadProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [items, setItems] = useState<BulkUploadItem[]>([]);
  const [uploading, setUploading] = useState(false);
  const [dragging, setDragging] = useState(false);

  const addFiles = useCallback((fileList: FileList | null) => {
    if (!fileList?.length) return;
    const existing = new Set(items.map((i) => i.uploadName));
    const next: BulkUploadItem[] = [];
    for (let i = 0; i < fileList.length; i++) {
      const file = fileList[i];
      const err = validateFile(file);
      const uploadName = uniqueFilename(file.name, existing);
      next.push({
        id: `${Date.now()}-${i}-${file.name}`,
        file,
        status: err ? 'error' : 'pending',
        error: err ?? undefined,
        uploadName,
      });
    }
    setItems((prev) => [...prev, ...next]);
  }, [items]);

  const removeItem = useCallback((id: string) => {
    setItems((prev) => prev.filter((i) => i.id !== id));
  }, []);

  const startUpload = useCallback(async () => {
    const pending = items.filter((i) => i.status === 'pending');
    if (pending.length === 0) return;
    setUploading(true);
    const successIds: string[] = [];
    await Promise.all(
      pending.map(async (item) => {
        setItems((prev) =>
          prev.map((i) =>
            i.id === item.id ? { ...i, status: 'uploading' as const } : i
          )
        );
        try {
          const { uploadUrl } = await getUploadUrl(
            opportunityId,
            item.uploadName,
            item.file.type
          );
          await uploadToS3(uploadUrl, item.file);
          setItems((prev) =>
            prev.map((i) =>
              i.id === item.id ? { ...i, status: 'uploaded' as const } : i
            )
          );
          successIds.push(item.id);
        } catch (e) {
          setItems((prev) =>
            prev.map((i) =>
              i.id === item.id
                ? {
                    ...i,
                    status: 'error' as const,
                    error: e instanceof Error ? e.message : 'Upload failed',
                  }
                : i
            )
          );
        }
      })
    );
    setUploading(false);
    const successCount = successIds.length;
    if (successCount > 0) {
      onBulkUploadComplete(successCount);
    }
  }, [opportunityId, items, onBulkUploadComplete]);

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    addFiles(e.dataTransfer.files);
  };

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    addFiles(e.target.files);
    e.target.value = '';
  };

  const pendingCount = items.filter((i) => i.status === 'pending').length;
  const uploadedCount = items.filter((i) => i.status === 'uploaded').length;
  const uploadingCount = items.filter((i) => i.status === 'uploading').length;
  const canUpload = pendingCount > 0 && !uploading;
  const analyzedCount =
    bulkPendingCount > 0
      ? Math.min(
          Math.max(0, currentCandidateCount - bulkStartedAtCount),
          bulkPendingCount
        )
      : 0;

  return (
    <div className="card">
      <div className="card-header">
        <h3>📤 Bulk upload</h3>
        {items.length > 0 && (
          <span style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>
            {items.length} file{items.length !== 1 ? 's' : ''}
          </span>
        )}
      </div>
      <div className="card-body">
        <div
          className={`upload-zone upload-zone-bulk ${dragging ? 'dragging' : ''}`}
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          style={{
            border: '2px dashed var(--border)',
            borderRadius: 8,
            padding: 20,
            textAlign: 'center',
            color: 'var(--text-tertiary)',
            fontSize: 13,
            cursor: 'pointer',
            background: 'var(--bg-secondary)',
            marginBottom: items.length > 0 ? 16 : 0,
          }}
          onClick={() => inputRef.current?.click()}
        >
          <input
            ref={inputRef}
            type="file"
            multiple
            accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            onChange={onFileChange}
            style={{ display: 'none' }}
          />
          <div style={{ marginBottom: 6, fontSize: 18 }}>📁</div>
          <div style={{ fontWeight: 500, color: 'var(--text-secondary)', marginBottom: 4 }}>
            Drop multiple resumes or click to select
          </div>
          <div style={{ fontSize: 12 }}>PDF or DOCX • Max {MAX_SIZE_MB}MB each</div>
          <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 6 }}>
            Bulk analysis may take several minutes depending on how many files you upload.
          </div>
        </div>

        {bulkPendingCount > 0 && (
          <div
            style={{
              marginBottom: 12,
              padding: 12,
              background: 'var(--accent-primary-light)',
              borderRadius: 8,
              fontSize: 13,
              color: 'var(--text-secondary)',
            }}
          >
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
              <span
                style={{
                  width: 16,
                  height: 16,
                  border: '2px solid var(--accent-primary)',
                  borderTopColor: 'transparent',
                  borderRadius: '50%',
                  animation: 'spin 0.8s linear infinite',
                }}
              />
              Analyzing… {analyzedCount} of {bulkPendingCount} done
            </span>
            <div style={{ marginTop: 8, fontSize: 12, color: 'var(--text-tertiary)' }}>
              This may take a few minutes. Each resume is analyzed in turn; new candidates will appear in the list above as they finish.
            </div>
          </div>
        )}

        {items.length > 0 && (
          <>
            <ul
              style={{
                listStyle: 'none',
                margin: 0,
                padding: 0,
                fontSize: 12,
                maxHeight: 180,
                overflowY: 'auto',
              }}
            >
              {items.map((item) => (
                <li
                  key={item.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '6px 8px',
                    borderRadius: 6,
                    background: 'var(--bg-secondary)',
                    marginBottom: 4,
                  }}
                >
                  <span
                    style={{
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      flex: 1,
                      marginRight: 8,
                    }}
                    title={item.file.name}
                  >
                    {item.uploadName}
                  </span>
                  <span style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: 6 }}>
                    {item.status === 'pending' && (
                      <span style={{ color: 'var(--text-tertiary)' }}>Pending</span>
                    )}
                    {item.status === 'uploading' && (
                      <span
                        style={{
                          width: 12,
                          height: 12,
                          border: '2px solid var(--text-tertiary)',
                          borderTopColor: 'transparent',
                          borderRadius: '50%',
                          animation: 'spin 0.8s linear infinite',
                        }}
                      />
                    )}
                    {item.status === 'uploaded' && (
                      <span style={{ color: 'var(--accent-green)' }}>✓</span>
                    )}
                    {item.status === 'error' && (
                      <span style={{ color: 'var(--accent-red)', fontSize: 11 }}>
                        {item.error}
                      </span>
                    )}
                    <button
                      type="button"
                      className="btn btn-outline btn-sm"
                      style={{ padding: '2px 6px', fontSize: 11 }}
                      onClick={(e) => {
                        e.stopPropagation();
                        removeItem(item.id);
                      }}
                      aria-label="Remove"
                    >
                      ×
                    </button>
                  </span>
                </li>
              ))}
            </ul>
            {canUpload && (
              <button
                type="button"
                className="btn btn-primary btn-sm"
                style={{ marginTop: 12 }}
                onClick={startUpload}
              >
                Upload {pendingCount} file{pendingCount !== 1 ? 's' : ''}
              </button>
            )}
            {uploading && uploadingCount > 0 && (
              <div style={{ marginTop: 8, fontSize: 12, color: 'var(--text-tertiary)' }}>
                Uploading {uploadingCount}…
              </div>
            )}
            {uploadedCount > 0 && bulkPendingCount === 0 && !uploading && (
              <div style={{ marginTop: 8, fontSize: 12, color: 'var(--accent-green)' }}>
                {uploadedCount} uploaded. They will appear in the list above as analysis completes.
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
