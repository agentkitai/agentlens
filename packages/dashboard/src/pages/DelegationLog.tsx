import React, { useState } from 'react';
import { useApi } from '../hooks/useApi';
import { getDelegations, type DelegationLogData } from '../api/client';

function formatTimestamp(ts: string): string {
  try { return new Date(ts).toLocaleString(); } catch { return ts; }
}

export default function DelegationLog() {
  const [direction, setDirection] = useState('');
  const [status, setStatus] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const delegationsQuery = useApi(
    () => getDelegations({
      direction: direction || undefined,
      status: status || undefined,
      from: dateFrom || undefined,
      to: dateTo || undefined,
      limit: 100,
    }),
    [direction, status, dateFrom, dateTo],
  );

  const delegations = delegationsQuery.data?.delegations ?? [];

  return (
    <div style={{ padding: '24px', maxWidth: '1200px', margin: '0 auto' }}>
      <h1 style={{ margin: '0 0 24px', fontSize: '24px' }}>📊 Delegation Log</h1>

      {/* Filters */}
      <div style={{ display: 'flex', gap: '8px', marginBottom: '16px', flexWrap: 'wrap' }}>
        <select value={direction} onChange={(e) => setDirection(e.target.value)} data-testid="direction-filter" style={inputStyle}>
          <option value="">All Directions</option>
          <option value="inbound">Inbound</option>
          <option value="outbound">Outbound</option>
        </select>
        <select value={status} onChange={(e) => setStatus(e.target.value)} data-testid="status-filter" style={inputStyle}>
          <option value="">All Statuses</option>
          <option value="request">Request</option>
          <option value="accepted">Accepted</option>
          <option value="completed">Completed</option>
          <option value="rejected">Rejected</option>
          <option value="timeout">Timeout</option>
          <option value="error">Error</option>
        </select>
        <input
          type="date"
          value={dateFrom}
          onChange={(e) => setDateFrom(e.target.value)}
          data-testid="date-from"
          style={inputStyle}
        />
        <input
          type="date"
          value={dateTo}
          onChange={(e) => setDateTo(e.target.value)}
          data-testid="date-to"
          style={inputStyle}
        />
      </div>

      {delegationsQuery.loading && <p>Loading...</p>}
      {delegationsQuery.error && <p style={{ color: '#ef4444' }}>Error: {delegationsQuery.error}</p>}

      {!delegationsQuery.loading && delegations.length === 0 && (
        <p style={{ color: '#888' }}>No delegations found.</p>
      )}

      <table style={{ width: '100%', borderCollapse: 'collapse' }} data-testid="delegation-table">
        <thead>
          <tr style={{ borderBottom: '2px solid #e2e8f0', textAlign: 'left' }}>
            <th style={thStyle}>Direction</th>
            <th style={thStyle}>Task Type</th>
            <th style={thStyle}>Status</th>
            <th style={thStyle}>Timing</th>
            <th style={thStyle}>Cost</th>
            <th style={thStyle}>Created</th>
            <th style={thStyle}></th>
          </tr>
        </thead>
        <tbody>
          {delegations.map((d) => (
            <React.Fragment key={d.id}>
              <tr
                style={{ borderBottom: '1px solid #e2e8f0', cursor: 'pointer' }}
                onClick={() => setExpandedId(expandedId === d.id ? null : d.id)}
                data-testid={`delegation-row-${d.id}`}
              >
                <td style={tdStyle}>
                  <span style={{ color: d.direction === 'inbound' ? '#3b82f6' : '#8b5cf6' }}>
                    {d.direction === 'inbound' ? '⬇️' : '⬆️'} {d.direction}
                  </span>
                </td>
                <td style={tdStyle}>{d.taskType}</td>
                <td style={tdStyle}>
                  <span style={statusStyle(d.status)}>{d.status}</span>
                </td>
                <td style={tdStyle}>
                  {d.executionTimeMs != null ? `${d.executionTimeMs}ms` : '—'}
                </td>
                <td style={tdStyle}>
                  {d.costUsd != null ? `$${d.costUsd.toFixed(4)}` : '—'}
                </td>
                <td style={tdStyle}>{formatTimestamp(d.createdAt)}</td>
                <td style={tdStyle}>{expandedId === d.id ? '▲' : '▼'}</td>
              </tr>
              {expandedId === d.id && (
                <tr data-testid={`delegation-detail-${d.id}`}>
                  <td colSpan={7} style={{ padding: '12px 16px', background: '#f8fafc', fontSize: '13px' }}>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                      <div><strong>ID:</strong> {d.id}</div>
                      <div><strong>Agent:</strong> {d.agentId}</div>
                      {d.anonymousTargetId && <div><strong>Target:</strong> {d.anonymousTargetId}</div>}
                      {d.anonymousSourceId && <div><strong>Source:</strong> {d.anonymousSourceId}</div>}
                      {d.requestSizeBytes !== undefined && <div><strong>Request Size:</strong> {d.requestSizeBytes}B</div>}
                      {d.responseSizeBytes !== undefined && <div><strong>Response Size:</strong> {d.responseSizeBytes}B</div>}
                      {d.completedAt && <div><strong>Completed:</strong> {formatTimestamp(d.completedAt)}</div>}
                    </div>
                  </td>
                </tr>
              )}
            </React.Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function statusStyle(status: string): React.CSSProperties {
  const colors: Record<string, string> = {
    completed: '#22c55e',
    request: '#3b82f6',
    accepted: '#8b5cf6',
    rejected: '#ef4444',
    timeout: '#f59e0b',
    error: '#ef4444',
  };
  return {
    padding: '2px 8px',
    borderRadius: '12px',
    fontSize: '11px',
    fontWeight: 600,
    color: colors[status] ?? '#64748b',
    background: (colors[status] ?? '#64748b') + '20',
  };
}

const inputStyle: React.CSSProperties = {
  padding: '6px 10px', border: '1px solid #d1d5db', borderRadius: '4px', fontSize: '14px',
};
const thStyle: React.CSSProperties = { padding: '8px 12px', fontSize: '13px', color: '#64748b' };
const tdStyle: React.CSSProperties = { padding: '8px 12px', fontSize: '13px' };
