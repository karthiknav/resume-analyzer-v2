import { useEffect, useState } from 'react';
import { getAnalysis, sendChat } from '../api/client';
import type { AnalysisDetail as AnalysisDetailType, Candidate } from '../api/types';
import { UploadResume } from './UploadResume';

function ScoreClass(score: number) {
  if (score >= 80) return 'score-high';
  if (score >= 60) return 'score-medium';
  return 'score-low';
}

interface AnalysisProps {
  opportunityId: string;
  opportunityTitle: string;
  onBack: () => void;
}

export function Analysis({
  opportunityId,
  opportunityTitle,
  onBack,
}: AnalysisProps) {
  const [data, setData] = useState<AnalysisDetailType | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Candidate | null>(null);
  const [chatMessages, setChatMessages] = useState<
    Array<{ role: 'user' | 'agent'; text: string }>
  >([
    {
      role: 'agent',
      text: "I've analyzed the candidates for this opportunity. Select one to see details, or upload a new resume.",
    },
  ]);
  const [chatInput, setChatInput] = useState('');
  const [chatLoading, setChatLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    getAnalysis(opportunityId)
      .then((res) => {
        if (!cancelled) {
          setData(res);
          if (res.candidates?.length) setSelected(res.candidates[0]);
        }
      })
      .catch((e) => {
        if (!cancelled)
          setError(e instanceof Error ? e.message : 'Failed to load analysis');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [opportunityId]);

  const handleSendChat = async () => {
    const msg = chatInput.trim();
    if (!msg) return;
    const candidateId = (selected ?? data?.candidates?.[0])?.id;
    if (!candidateId) {
      setChatMessages((prev) => [...prev, { role: 'user', text: msg }, { role: 'agent', text: 'Please select a candidate to ask questions about.' }]);
      setChatInput('');
      return;
    }
    setChatMessages((prev) => [...prev, { role: 'user', text: msg }]);
    setChatInput('');
    setChatLoading(true);
    try {
      const { reply } = await sendChat(opportunityId, candidateId, msg);
      setChatMessages((prev) => [...prev, { role: 'agent', text: reply || 'No response.' }]);
    } catch (e) {
      setChatMessages((prev) => [...prev, { role: 'agent', text: `Error: ${e instanceof Error ? e.message : 'Failed to get response'}` }]);
    } finally {
      setChatLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="page">
        <div style={{ padding: 48, textAlign: 'center', color: 'var(--text-tertiary)' }}>
          Loading analysis…
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="page">
        <div style={{ padding: 24, background: '#FEE2E2', borderRadius: 8, color: '#DC2626' }}>
          {error ?? 'No data'}
        </div>
        <button type="button" className="btn btn-outline" onClick={onBack}>
          ← Back
        </button>
      </div>
    );
  }

  const cand = selected ?? data.candidates?.[0];
  const jd = data.jd ?? { tags: [], summary: '' };
  // Use selected candidate's analysis from S3; fallback to legacy data
  const coreSkills = cand?.coreSkills ?? data.coreSkills ?? [];
  const domainSkills = cand?.domainSkills ?? data.domainSkills ?? [];
  const evidenceSnippets = cand?.evidenceSnippets ?? data.evidenceSnippets ?? [];
  const gaps = cand?.gaps ?? data.gaps ?? [];
  const recommendation = cand?.recommendation ?? data.recommendation ?? '';

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h2>{opportunityTitle}</h2>
          <p className="page-header-subtitle">JD Analysis & Candidate Matching</p>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <button type="button" className="btn btn-outline" onClick={onBack}>
            ← Back
          </button>
          <button type="button" className="btn btn-primary">
            📄 Export Report
          </button>
        </div>
      </div>

      <div className="analysis-layout">
        <div className="left-panel">
          <div className="card">
            <div className="card-header">
              <h3>📋 JD Requirements</h3>
              <span className="badge badge-analyzed"><span className="dot-sm" /> Cached</span>
            </div>
            <div className="card-body">
              <div style={{ marginBottom: 10 }}>
                {jd.tags.map((t) => (
                  <span key={t.label} className="jd-tag">
                    {t.years ? `${t.label} (${t.years})` : t.label}
                  </span>
                ))}
              </div>
              <p className="jd-requirement-text">{jd.summary}</p>
            </div>
          </div>

          <div className="card">
            <div className="card-header">
              <h3>👥 Ranked Candidates</h3>
              <span style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>
                {data.candidates?.length ?? 0} analyzed
              </span>
            </div>
            <div className="card-body ranked-candidates-list" style={{ padding: 0 }}>
              <table className="candidates-table">
                <thead>
                  <tr>
                    <th className="col-rank">#</th>
                    <th className="col-name">Name</th>
                    <th className="col-level">Level</th>
                    <th className="col-score">Score</th>
                  </tr>
                </thead>
                <tbody>
                  {data.candidates?.map((c, i) => (
                    <tr
                      key={c.id}
                      className={cand?.id === c.id ? 'active' : ''}
                      onClick={() => setSelected(c)}
                    >
                      <td className="col-rank">
                        <span className={`candidate-rank rank-${Math.min(i + 1, 4)}`}>
                          {i + 1}
                        </span>
                      </td>
                      <td className="col-name">
                        <span className="candidate-name">{c.name}</span>
                      </td>
                      <td className="col-level">
                        <span className="candidate-level">
                          {c.level} • {c.experienceYears} yrs
                        </span>
                      </td>
                      <td className="col-score">
                        <div className="candidate-score">
                          <span className={`score-value ${ScoreClass(c.overallScore)}`}>
                            {c.overallScore}%
                          </span>
                          <span className="score-breakdown">
                            {c.coreScore}/{c.domainScore}/{c.softScore}
                          </span>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <UploadResume opportunityId={opportunityId} candidateId={selected?.id} />
        </div>

        <div className="right-panel">
          {cand && (
            <>
              <div className="card">
                <div className="profile-header">
                  <div className="profile-avatar">{cand.initials}</div>
                  <div className="profile-info">
                    <h3>{cand.name}</h3>
                    <div className="profile-meta">
                      <span className="profile-meta-item">🎯 {cand.level}</span>
                      <span className="profile-meta-item">📅 {cand.experienceYears} yrs experience</span>
                      {cand.location && (
                        <span className="profile-meta-item">📍 {cand.location}</span>
                      )}
                    </div>
                  </div>
                  <div className="overall-score">
                    <div className="overall-score-value">{cand.overallScore}%</div>
                    <div className="overall-score-label">Overall Match</div>
                  </div>
                </div>
                <div className="score-bars">
                  <div className="score-bar-item">
                    <div className="score-bar-label">
                      <span>Core Skills</span>
                      <span>{cand.coreScore}%</span>
                    </div>
                    <div className="score-bar-track">
                      <div
                        className="score-bar-fill fill-blue"
                        style={{ width: `${cand.coreScore}%` }}
                      />
                    </div>
                  </div>
                  <div className="score-bar-item">
                    <div className="score-bar-label">
                      <span>Domain</span>
                      <span>{cand.domainScore}%</span>
                    </div>
                    <div className="score-bar-track">
                      <div
                        className="score-bar-fill fill-green"
                        style={{ width: `${cand.domainScore}%` }}
                      />
                    </div>
                  </div>
                  <div className="score-bar-item">
                    <div className="score-bar-label">
                      <span>Soft Skills</span>
                      <span>{cand.softScore}%</span>
                    </div>
                    <div className="score-bar-track">
                      <div
                        className="score-bar-fill fill-amber"
                        style={{ width: `${cand.softScore}%` }}
                      />
                    </div>
                  </div>
                </div>
              </div>

              <div className="two-col">
                <div className="card">
                  <div className="card-header">
                    <h3>✅ Core Skills Match</h3>
                  </div>
                  <div className="card-body">
                    <div className="skills-check-grid">
                      {coreSkills.map((s) => (
                        <div key={s.name} className="skill-check-item">
                          <div className={`skill-check-icon check-${s.status ?? 'partial'}`}>
                            {s.status === 'pass' ? '✓' : s.status === 'partial' ? '~' : '✗'}
                          </div>
                          <div className="skill-check-detail">
                            <div className="skill-check-name">{s.name}</div>
                            <div className="skill-check-years">
                              {[s.years, s.level].filter(Boolean).join(' • ')}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="card">
                  <div className="card-header">
                    <h3>🏢 Domain Skills</h3>
                  </div>
                  <div className="card-body domain-table-wrap" style={{ padding: 0 }}>
                    <table className="domain-table">
                      <thead>
                        <tr>
                          <th>Domain Skill</th>
                          <th>JD Priority</th>
                          <th>Level</th>
                          <th>Evidence</th>
                        </tr>
                      </thead>
                      <tbody>
                        {domainSkills.map((d) => (
                          <tr key={d.skill}>
                            <td style={{ fontWeight: 600 }}>{d.skill}</td>
                            <td>
                              <span className={`priority-${d.priority.toLowerCase()}`}>
                                {d.priority}
                              </span>
                            </td>
                            <td>
                              <span className={`level-${d.level.toLowerCase()}`}>
                                {d.level}
                              </span>
                            </td>
                            <td className="evidence-text">{d.evidence}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>

              <div className="two-col">
                <div className="card">
                  <div className="card-header">
                    <h3>📝 Evidence Snippets</h3>
                  </div>
                  <div className="card-body">
                    {evidenceSnippets.map((s, i) => (
                      <div key={i} className="evidence-snippet">
                        "{s}"
                      </div>
                    ))}
                  </div>
                </div>

                <div className="card">
                  <div className="card-header">
                    <h3>⚠️ Gaps &amp; Risks</h3>
                  </div>
                  <div className="card-body">
                    {gaps.map((g, i) => (
                      <div key={i} className="gap-item">
                        <span className="gap-icon">⚠</span>
                        <span>{g}</span>
                      </div>
                    ))}
                    {recommendation && (
                      <div className="recommendation-box">
                        <div className="recommendation-label">✅ Recommendation</div>
                        <p className="recommendation-text">{recommendation}</p>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </>
          )}

          <div className="card">
            <div className="card-header">
              <h3>💬 Ask about JD or Profile</h3>
              <span style={{ fontSize: 11, color: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)' }}>
                Resume Analysis Active
              </span>
            </div>
            <div className="chat-section">
              <div className="chat-messages">
                {chatMessages.map((m, i) => (
                  <div key={i} className={`chat-msg ${m.role}`}>
                    <div className="chat-msg-avatar">{m.role === 'agent' ? 'AI' : 'SM'}</div>
                    <div className="chat-msg-bubble">{m.text}</div>
                  </div>
                ))}
                {chatLoading && (
                  <div className="chat-msg agent">
                    <div className="chat-msg-avatar">AI</div>
                    <div className="chat-msg-bubble" style={{ opacity: 0.7 }}>Thinking…</div>
                  </div>
                )}
              </div>
              <div className="chat-input-row">
                <input
                  type="text"
                  className="chat-input"
                  placeholder="Ask any further questions about JD or Profile..."
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && !chatLoading && handleSendChat()}
                  disabled={chatLoading}
                />
                <button type="button" className="chat-send" onClick={handleSendChat} disabled={chatLoading}>
                  →
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
