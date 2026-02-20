import React, { useState, useCallback } from 'react';
import { useApi } from '../hooks/useApi';
import {
  verifyAuditChain,
  generateComplianceReport,
  getExportEventsUrl,
  type ComplianceReportSummary,
  type ChainVerification,
} from '../api/client';

// ─── Helpers ────────────────────────────────────────────────

function formatDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function defaultFrom(): string {
  const d = new Date();
  d.setDate(d.getDate() - 30);
  return formatDate(d);
}

function defaultTo(): string {
  return formatDate(new Date());
}

// ─── Main Page ──────────────────────────────────────────────

export default function Compliance() {
  const chainQuery = useApi(() => verifyAuditChain(), []);

  const [from, setFrom] = useState(defaultFrom);
  const [to, setTo] = useState(defaultTo);
  const [generating, setGenerating] = useState(false);
  const [report, setReport] = useState<ComplianceReportSummary | null>(null);
  const [reportError, setReportError] = useState('');
  const [history, setHistory] = useState<Array<{ generatedAt: string; from: string; to: string }>>([]);

  const chain: ChainVerification | null = chainQuery.data ?? null;

  const handleGenerate = useCallback(async () => {
    setGenerating(true);
    setReportError('');
    setReport(null);
    try {
      const fromDate = new Date(from);
      const toDate = new Date(to);
      const diffDays = (toDate.getTime() - fromDate.getTime()) / (1000 * 60 * 60 * 24);
      if (diffDays > 365) {
        setReportError('Date range must not exceed 365 days.');
        return;
      }
      if (diffDays < 0) {
        setReportError('"From" date must be before "To" date.');
        return;
      }
      const result = await generateComplianceReport(from, to);
      setReport(result);
      setHistory(prev => [{ generatedAt: new Date().toISOString(), from, to }, ...prev]);
    } catch (err: unknown) {
      setReportError(err instanceof Error ? err.message : String(err));
    } finally {
      setGenerating(false);
    }
  }, [from, to]);

  const handleExport = useCallback((format: 'json' | 'csv') => {
    const url = getExportEventsUrl(from, to, format);
    window.open(url, '_blank');
  }, [from, to]);

  return (
    <div style={{ padding: '24px', maxWidth: '1000px', margin: '0 auto' }}>
      <h1 style={{ margin: '0 0 24px', fontSize: '24px' }}>📋 EU AI Act Compliance</h1>

      {/* Chain Integrity Status */}
      <div style={cardStyle}>
        <h3 style={{ margin: '0 0 8px', fontSize: '16px' }}>Audit Chain Integrity</h3>
        {chainQuery.loading && <p style={{ color: '#888' }}>Verifying chain integrity...</p>}
        {chainQuery.error && <p style={{ color: '#ef4444' }}>Error: {String(chainQuery.error)}</p>}
        {chain && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <span style={{
              display: 'inline-block', width: '12px', height: '12px', borderRadius: '50%',
              background: chain.verified ? '#22c55e' : '#ef4444',
            }} />
            <span style={{ fontWeight: 600, color: chain.verified ? '#16a34a' : '#dc2626' }}>
              {chain.verified ? 'Verified' : 'Broken'}
            </span>
            <span style={{ color: '#888', fontSize: '13px' }}>
              ({chain.sessionsChecked} sessions checked)
            </span>
            {!chain.verified && chain.brokenChains.length > 0 && (
              <span style={{ color: '#ef4444', fontSize: '13px' }}>
                Broken: {chain.brokenChains.join(', ')}
              </span>
            )}
            <button onClick={() => chainQuery.refetch()} style={smallBtnStyle}>↻ Refresh</button>
          </div>
        )}
      </div>

      {/* Report Generation */}
      <div style={cardStyle}>
        <h3 style={{ margin: '0 0 12px', fontSize: '16px' }}>Generate Compliance Report</h3>
        <div style={{ display: 'flex', gap: '12px', alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <label>From<br />
            <input type="date" value={from} onChange={e => setFrom(e.target.value)} style={inputStyle} />
          </label>
          <label>To<br />
            <input type="date" value={to} onChange={e => setTo(e.target.value)} style={inputStyle} />
          </label>
          <button onClick={handleGenerate} disabled={generating} style={btnStyle}>
            {generating ? 'Generating...' : '📊 Generate Report'}
          </button>
        </div>
        {reportError && <p style={{ color: '#ef4444', marginTop: '8px' }}>{reportError}</p>}
      </div>

      {/* Report Summary */}
      {report && (
        <div style={{ ...cardStyle, background: '#f0fdf4' }}>
          <h3 style={{ margin: '0 0 12px', fontSize: '16px' }}>📄 Report Summary</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '12px', fontSize: '14px' }}>
            <div><strong>Period:</strong> {report.range.from} → {report.range.to}</div>
            <div><strong>Events:</strong> {report.totalEvents.toLocaleString()}</div>
            <div><strong>Agents:</strong> {report.agentCount}</div>
            <div><strong>Sessions:</strong> {report.sessionCount}</div>
            <div><strong>Guardrail Triggers:</strong> {report.guardrailTriggers}</div>
            <div>
              <strong>Chain:</strong>{' '}
              <span style={{ color: report.chainVerification.verified ? '#16a34a' : '#dc2626' }}>
                {report.chainVerification.verified ? '✓ Verified' : '✗ Broken'}
              </span>
            </div>
            {report.signature && (
              <div><strong>Signature:</strong> <code style={{ fontSize: '11px' }}>{report.signature.slice(0, 16)}...</code></div>
            )}
          </div>

          {/* Export Buttons */}
          <div style={{ marginTop: '16px', display: 'flex', gap: '8px' }}>
            <button onClick={() => handleExport('json')} style={smallBtnStyle}>⬇ Export JSON</button>
            <button onClick={() => handleExport('csv')} style={smallBtnStyle}>⬇ Export CSV</button>
          </div>
        </div>
      )}

      {/* Export History */}
      {history.length > 0 && (
        <div style={cardStyle}>
          <h3 style={{ margin: '0 0 12px', fontSize: '16px' }}>Report History</h3>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '2px solid #e2e8f0', textAlign: 'left' }}>
                <th style={thStyle}>Generated</th>
                <th style={thStyle}>From</th>
                <th style={thStyle}>To</th>
              </tr>
            </thead>
            <tbody>
              {history.map((h, i) => (
                <tr key={i} style={{ borderBottom: '1px solid #e2e8f0' }}>
                  <td style={tdStyle}>{new Date(h.generatedAt).toLocaleString()}</td>
                  <td style={tdStyle}>{h.from}</td>
                  <td style={tdStyle}>{h.to}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export { Compliance };

// ─── Styles ─────────────────────────────────────────────────

const cardStyle: React.CSSProperties = {
  padding: '16px', border: '1px solid #e2e8f0', borderRadius: '8px', marginBottom: '16px',
};

const btnStyle: React.CSSProperties = {
  padding: '8px 16px', background: '#3b82f6', color: 'white', border: 'none',
  borderRadius: '6px', cursor: 'pointer', fontSize: '14px',
};

const smallBtnStyle: React.CSSProperties = {
  padding: '6px 12px', background: 'transparent', border: '1px solid #d1d5db',
  borderRadius: '4px', cursor: 'pointer', fontSize: '13px',
};

const inputStyle: React.CSSProperties = {
  padding: '6px 10px', border: '1px solid #d1d5db', borderRadius: '4px',
  fontSize: '14px', marginTop: '4px',
};

const thStyle: React.CSSProperties = { padding: '8px 12px', fontSize: '13px', color: '#64748b' };
const tdStyle: React.CSSProperties = { padding: '8px 12px', fontSize: '13px' };
