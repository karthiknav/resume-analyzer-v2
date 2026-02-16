import type { ReactNode } from 'react';

interface LayoutProps {
  children: ReactNode;
  screen: 'opportunities' | 'analysis';
  breadcrumbCurrent?: string;
  onNav: (screen: 'opportunities' | 'analysis') => void;
}

export function Layout({
  children,
  screen,
  breadcrumbCurrent,
  onNav,
}: LayoutProps) {
  return (
    <div className="app-layout">
      <aside className="sidebar">
        <div className="sidebar-header">
          <div className="sidebar-logo">
            <div className="sidebar-logo-icon">⚡</div>
            <div className="sidebar-logo-text">
              <h1>Resume Analyzer</h1>
              <span>Consulting Group</span>
            </div>
          </div>
        </div>
        <nav className="sidebar-nav">
          <div className="nav-label">Main</div>
          <a
            className={`nav-item ${screen === 'opportunities' ? 'active' : ''}`}
            onClick={() => onNav('opportunities')}
            href="#opportunities"
          >
            <span className="icon">📋</span> Opportunities <span className="nav-badge">7</span>
          </a>
          <a
            className={`nav-item ${screen === 'analysis' ? 'active' : ''}`}
            onClick={() => onNav('analysis')}
            href="#analysis"
          >
            <span className="icon">📊</span> Analysis
          </a>
          <a className="nav-item" href="#">
            <span className="icon">👥</span> Candidate Pool
          </a>
          <div className="nav-label">Admin</div>
          <a className="nav-item" href="#">
            <span className="icon">📄</span> JD Templates
          </a>
          <a className="nav-item" href="#">
            <span className="icon">⚙️</span> Settings
          </a>
        </nav>
        <div className="sidebar-footer">
          <div className="avatar">SM</div>
          <div className="user-info">
            Sharaf M.
            <span>Solutions Architect</span>
          </div>
        </div>
      </aside>

      <main className="main-content">
        <div className="topbar">
          <div className="topbar-left">
            <div className="topbar-breadcrumb">
              <a href="#opportunities" onClick={() => onNav('opportunities')}>
                Opportunities
              </a>
              {breadcrumbCurrent && (
                <>
                  <span> › </span>
                  <span className="current">{breadcrumbCurrent}</span>
                </>
              )}
            </div>
          </div>
          <div className="topbar-right">
            <div className="topbar-status">
              <span className="dot" /> All agents online
            </div>
          </div>
        </div>
        {children}
      </main>
    </div>
  );
}
