import { useRef, useEffect, useState } from 'react';
import { listOpportunities, getUploadJdUrl, uploadToS3 } from '../api/client';
import type { Opportunity as OppType } from '../api/types';
import { usePolling } from '../hooks/usePolling';

const JD_ACCEPT = '.pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const MAX_JD_SIZE_MB = 10;

const STATUS_BADGE: Record<string, string> = {
  new: 'badge-new',
  active: 'badge-analyzed',
  progress: 'badge-progress',
  in_progress: 'badge-progress',
  analyzed: 'badge-analyzed',
  completed: 'badge-closed',
  closed: 'badge-closed',
};

const STATUS_LABEL: Record<string, string> = {
  new: 'New',
  active: 'Active',
  progress: 'In Progress',
  in_progress: 'In Progress',
  analyzed: 'Analyzed',
  completed: 'Closed',
  closed: 'Closed',
};

function getStatusDisplay(status: string): { badgeClass: string; label: string } {
  const normalized = (status || '').toLowerCase().replace(/\s+/g, '_');
  const badgeClass = STATUS_BADGE[normalized] ?? 'badge-closed';
  const label = (STATUS_LABEL[normalized] ?? status) || '—';
  return { badgeClass, label };
}

function Badge({ status }: { status: string }) {
  const { badgeClass, label } = getStatusDisplay(status);
  return (
    <span className={`badge ${badgeClass}`}>
      <span className="dot-sm" />
      {label}
    </span>
  );
}

interface OpportunitiesProps {
  onOpenAnalysis: (id: string, title: string) => void;
}

export function Opportunities({ onOpenAnalysis }: OpportunitiesProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [opportunities, setOpportunities] = useState<OppType[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<string>('all');
  const [uploadingJd, setUploadingJd] = useState(false);
  const [processingJd, setProcessingJd] = useState(false);
  const [uploadedFileName, setUploadedFileName] = useState<string | null>(null);
  const [jdMessage, setJdMessage] = useState<{ type: 'success' | 'error' | 'info'; text: string } | null>(null);
  const [pendingOpportunity, setPendingOpportunity] = useState<OppType | null>(null);
  const [opportunityCountBeforeUpload, setOpportunityCountBeforeUpload] = useState<number>(0);

  const refreshList = () => {
    listOpportunities()
      .then(setOpportunities)
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load'));
  };

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    listOpportunities()
      .then((data) => {
        if (!cancelled) setOpportunities(data);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  const handleNewOpportunityClick = () => {
    setJdMessage(null);
    fileInputRef.current?.click();
  };

  const handleJdFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (file.size > MAX_JD_SIZE_MB * 1024 * 1024) {
      setJdMessage({ type: 'error', text: `File must be under ${MAX_JD_SIZE_MB}MB` });
      return;
    }
    setUploadingJd(true);
    setProcessingJd(false);
    setJdMessage(null);
    setPendingOpportunity(null);
    setUploadedFileName(file.name);
    // Store current count to detect new opportunities
    setOpportunityCountBeforeUpload(opportunities.length);
    
    try {
      // Step 1: Upload to S3
      const { uploadUrl } = await getUploadJdUrl(file.name, file.type);
      await uploadToS3(uploadUrl, file);
      
      // Step 2: Show processing state
      setUploadingJd(false);
      setProcessingJd(true);
      setJdMessage({
        type: 'info',
        text: `File uploaded successfully. Processing job description...`,
      });
      
      // Add a temporary pending opportunity to the list
      const tempOpp: OppType = {
        id: `pending-${Date.now()}`,
        title: file.name.replace(/\.[^/.]+$/, ''),
        client: 'Processing...',
        status: 'progress',
        candidatesCount: 0,
        created: new Date().toLocaleDateString(),
      };
      setPendingOpportunity(tempOpp);
      
      // Refresh list immediately to see if it's already processed
      refreshList();
    } catch (e) {
      setUploadingJd(false);
      setProcessingJd(false);
      setJdMessage({
        type: 'error',
        text: e instanceof Error ? e.message : 'Upload failed',
      });
      setPendingOpportunity(null);
    }
  };

  // Poll for new opportunity after upload
  usePolling({
    enabled: processingJd,
    checkFn: async () => {
      const currentList = await listOpportunities();
      // Check if a new opportunity appeared (count increased or new one matches filename)
      const hasNewOpportunity = currentList.length > opportunityCountBeforeUpload || 
        currentList.some(
          (opp) => opp.id !== pendingOpportunity?.id && 
          uploadedFileName && 
          (opp.title.toLowerCase().includes(uploadedFileName.toLowerCase().replace(/\.[^/.]+$/, '')) ||
           opp.s3Key?.includes(uploadedFileName))
        );
      
      if (hasNewOpportunity) {
        setOpportunities(currentList);
        return true;
      }
      return false;
    },
    interval: 2000,
    maxAttempts: 30, // 60 seconds max
    onSuccess: () => {
      setProcessingJd(false);
      setPendingOpportunity(null);
      setJdMessage({
        type: 'success',
        text: 'Job description processed successfully!',
      });
      // Clear message after 3 seconds
      setTimeout(() => setJdMessage(null), 3000);
    },
    onTimeout: () => {
      setProcessingJd(false);
      setJdMessage({
        type: 'info',
        text: 'Processing is taking longer than expected. The opportunity will appear when ready.',
      });
      // Keep polling in background but don't show processing state
      setTimeout(() => {
        refreshList();
        setPendingOpportunity(null);
      }, 5000);
    },
  });

  // Merge pending opportunity with actual opportunities
  const allOpportunities = pendingOpportunity 
    ? [pendingOpportunity, ...opportunities.filter(o => o.id !== pendingOpportunity.id)]
    : opportunities;
  
  const filtered =
    filter === 'all'
      ? allOpportunities
      : filter === 'new'
        ? allOpportunities.filter((o) => o.status === 'new' || o.status === 'active')
        : allOpportunities.filter((o) => o.status === filter);

  const stats = {
    total: opportunities.length,
    analyzed: opportunities.reduce((s, o) => s + o.candidatesCount, 0),
    avgScore:
      opportunities.filter((o) => o.topScore != null).length > 0
        ? Math.round(
            opportunities.reduce((s, o) => s + (o.topScore ?? 0), 0) /
              opportunities.filter((o) => o.topScore != null).length
          )
        : 0,
  };

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h2>Job Openings</h2>
          <p className="page-header-subtitle">
            Manage client opportunities and candidate matching
          </p>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept={JD_ACCEPT}
          onChange={handleJdFileChange}
          style={{ display: 'none' }}
        />
        <button
          type="button"
          className="btn btn-primary"
          onClick={handleNewOpportunityClick}
          disabled={uploadingJd}
        >
          {uploadingJd ? 'Uploading…' : '+ New Opportunity'}
        </button>
      </div>

      {jdMessage && (
        <div
          style={{
            marginBottom: 16,
            padding: 12,
            borderRadius: 8,
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            background: 
              jdMessage.type === 'success' ? '#ECFDF5' : 
              jdMessage.type === 'info' ? '#EFF6FF' : 
              '#FEE2E2',
            color: 
              jdMessage.type === 'success' ? '#059669' : 
              jdMessage.type === 'info' ? '#1E40AF' : 
              '#DC2626',
          }}
        >
          {processingJd && (
            <div className="spinner" style={{ 
              width: 16, 
              height: 16, 
              border: '2px solid currentColor',
              borderTopColor: 'transparent',
              borderRadius: '50%',
              animation: 'spin 0.8s linear infinite',
            }} />
          )}
          {jdMessage.text}
        </div>
      )}

      {error && (
        <div style={{ marginBottom: 16, padding: 12, background: '#FEE2E2', borderRadius: 8, color: '#DC2626' }}>
          {error}
        </div>
      )}

      <div className="stats-row">
        <div className="stat-card">
          <div className="label">Total Openings</div>
          <div className="value">{loading ? '—' : stats.total}</div>
        </div>
        <div className="stat-card">
          <div className="label">Candidates Analyzed</div>
          <div className="value accent-blue">{loading ? '—' : stats.analyzed}</div>
        </div>
        <div className="stat-card">
          <div className="label">Avg. Match Score</div>
          <div className="value accent-green">{loading ? '—' : `${stats.avgScore}%`}</div>
        </div>
        <div className="stat-card">
          <div className="label">Avg. Analysis Time</div>
          <div className="value accent-amber">42s</div>
        </div>
      </div>

      <div className="opportunity-table">
        <div className="opportunity-table-header">
          <h3>Active Opportunities</h3>
          <div className="table-filters">
            {(['all', 'new', 'progress', 'closed'] as const).map((f) => (
              <button
                key={f}
                type="button"
                className={`filter-btn ${filter === f ? 'active' : ''}`}
                onClick={() => setFilter(f)}
              >
                {f === 'all' ? 'All' : f === 'progress' ? 'In Progress' : f === 'closed' ? 'Closed' : 'New'}
              </button>
            ))}
          </div>
        </div>
        {loading ? (
          <div style={{ padding: 32, textAlign: 'center', color: 'var(--text-tertiary)' }}>
            Loading…
          </div>
        ) : (
          <table className="opportunities-list-table">
            <thead>
              <tr>
                <th className="col-opportunity">Opportunity</th>
                <th>Client</th>
                <th>Status</th>
                <th>Candidates</th>
                <th>Top Score</th>
                <th className="col-created">Created</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {filtered.map((row) => {
                const isPending = row.id === pendingOpportunity?.id;
                return (
                  <tr
                    key={row.id}
                    onClick={() => !isPending && onOpenAnalysis(row.id, row.client && row.client !== 'N/A' ? `${row.title} — ${row.client}` : row.title)}
                    style={isPending ? { opacity: 0.7, cursor: 'not-allowed' } : {}}
                  >
                    <td style={{ overflow: 'hidden' }}>
                      <div className="opp-title" style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                        {isPending && (
                          <div className="spinner" style={{ 
                            width: 12, 
                            height: 12, 
                            flexShrink: 0,
                            border: '2px solid var(--text-tertiary)',
                            borderTopColor: 'transparent',
                            borderRadius: '50%',
                            animation: 'spin 0.8s linear infinite',
                          }} />
                        )}
                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>
                          {row.title}
                        </span>
                      </div>
                      <div className="opp-client">{row.keywords ?? '—'}</div>
                    </td>
                    <td className="opp-meta">{row.client}</td>
                    <td>
                      <Badge status={row.status} />
                    </td>
                    <td>
                      <span className="candidates-count">{row.candidatesCount}</span>
                    </td>
                    <td>
                      <span
                        className={`candidates-count ${
                          (row.topScore ?? 0) >= 80
                            ? 'score-high'
                            : (row.topScore ?? 0) >= 60
                              ? 'score-medium'
                              : ''
                        }`}
                      >
                        {row.topScore != null ? `${row.topScore}%` : '—'}
                      </span>
                    </td>
                    <td className="opp-meta opp-created">{row.created}</td>
                    <td>
                      {isPending ? (
                        <span style={{ color: 'var(--text-tertiary)', fontSize: 12 }}>Processing...</span>
                      ) : (
                        <span
                          className="action-link"
                          onClick={(e) => {
                            e.stopPropagation();
                            onOpenAnalysis(row.id, row.client && row.client !== 'N/A' ? `${row.title} — ${row.client}` : row.title);
                          }}
                        >
                          View →
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
