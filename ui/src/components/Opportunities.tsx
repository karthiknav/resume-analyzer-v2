import { useEffect, useState } from 'react';
import { listOpportunities } from '../api/client';
import type { Opportunity as OppType } from '../api/types';

const STATUS_BADGE: Record<string, string> = {
  new: 'badge-new',
  progress: 'badge-progress',
  analyzed: 'badge-analyzed',
  closed: 'badge-closed',
};

function Badge({ status }: { status: string }) {
  const c = STATUS_BADGE[status] ?? 'badge-closed';
  return (
    <span className={`badge ${c}`}>
      <span className="dot-sm" />
      {status === 'new' && 'New'}
      {status === 'progress' && 'In Progress'}
      {status === 'analyzed' && 'Analyzed'}
      {status === 'closed' && 'Closed'}
    </span>
  );
}

interface OpportunitiesProps {
  onOpenAnalysis: (id: string, title: string) => void;
}

export function Opportunities({ onOpenAnalysis }: OpportunitiesProps) {
  const [opportunities, setOpportunities] = useState<OppType[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<string>('all');

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

  const filtered =
    filter === 'all'
      ? opportunities
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
        <button type="button" className="btn btn-primary">
          + New Opportunity
        </button>
      </div>

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
          <table>
            <thead>
              <tr>
                <th>Opportunity</th>
                <th>Client</th>
                <th>Status</th>
                <th>Candidates</th>
                <th>Top Score</th>
                <th>Created</th>
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
                  <td className="opp-meta">{row.created}</td>
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
