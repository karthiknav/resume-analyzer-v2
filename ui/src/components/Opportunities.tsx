import { useRef, useEffect, useState } from 'react';
import { listOpportunities, getUploadJdUrl, uploadToS3 } from '../api/client';
import type { Opportunity as OppType } from '../api/types';

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
  const [jdMessage, setJdMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

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
    setJdMessage(null);
    try {
      const { uploadUrl, key } = await getUploadJdUrl(file.name, file.type);
      await uploadToS3(uploadUrl, file);
      setJdMessage({
        type: 'success',
        text: `Job description uploaded to S3 (${key}). Your trigger will process it.`,
      });
      refreshList();
    } catch (e) {
      setJdMessage({
        type: 'error',
        text: e instanceof Error ? e.message : 'Upload failed',
      });
    } finally {
      setUploadingJd(false);
    }
  };

  const filtered =
    filter === 'all'
      ? opportunities
      : filter === 'new'
        ? opportunities.filter((o) => o.status === 'new' || o.status === 'active')
        : opportunities.filter((o) => o.status === filter);

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
            background: jdMessage.type === 'success' ? '#ECFDF5' : '#FEE2E2',
            color: jdMessage.type === 'success' ? '#059669' : '#DC2626',
          }}
        >
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
            {(['all', 'new', 'progress', 'analyzed', 'closed'] as const).map((f) => (
              <button
                key={f}
                type="button"
                className={`filter-btn ${filter === f ? 'active' : ''}`}
                onClick={() => setFilter(f)}
              >
                {f === 'all' ? 'All' : f === 'progress' ? 'In Progress' : f === 'analyzed' ? 'Analyzed' : f === 'closed' ? 'Closed' : 'New'}
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
              {filtered.map((row) => (
                <tr
                  key={row.id}
                  onClick={() => onOpenAnalysis(row.id, `${row.title} — ${row.client}`)}
                >
                  <td>
                    <div className="opp-title">{row.title}</div>
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
                    <span
                      className="action-link"
                      onClick={(e) => {
                        e.stopPropagation();
                        onOpenAnalysis(row.id, `${row.title} — ${row.client}`);
                      }}
                    >
                      View →
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
