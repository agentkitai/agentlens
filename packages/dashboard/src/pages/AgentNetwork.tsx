import React, { useState } from 'react';
import { useApi } from '../hooks/useApi';
import { getCapabilities, type CapabilityData } from '../api/client';

export default function AgentNetwork() {
  const [taskTypeFilter, setTaskTypeFilter] = useState('');
  const [agentFilter, setAgentFilter] = useState('');

  const capsQuery = useApi(
    () => getCapabilities({
      taskType: taskTypeFilter || undefined,
      agentId: agentFilter || undefined,
    }),
    [taskTypeFilter, agentFilter],
  );

  const capabilities = capsQuery.data?.capabilities ?? [];

  // Group by agent
  const agentMap = new Map<string, CapabilityData[]>();
  for (const cap of capabilities) {
    const existing = agentMap.get(cap.agentId) ?? [];
    existing.push(cap);
    agentMap.set(cap.agentId, existing);
  }

  return (
    <div style={{ padding: '24px', maxWidth: '1200px', margin: '0 auto' }}>
      <h1 style={{ margin: '0 0 24px', fontSize: '24px' }}>🌐 Agent Network</h1>

      {/* Filters */}
      <div style={{ display: 'flex', gap: '8px', marginBottom: '16px' }}>
        <input
          value={taskTypeFilter}
          onChange={(e) => setTaskTypeFilter(e.target.value)}
          placeholder="Filter by task type..."
          data-testid="task-type-filter"
          style={inputStyle}
        />
        <input
          value={agentFilter}
          onChange={(e) => setAgentFilter(e.target.value)}
          placeholder="Filter by agent..."
          data-testid="agent-filter"
          style={inputStyle}
        />
      </div>

      {capsQuery.loading && <p>Loading...</p>}
      {capsQuery.error && <p style={{ color: '#ef4444' }}>Error: {capsQuery.error}</p>}

      {!capsQuery.loading && capabilities.length === 0 && (
        <p style={{ color: '#888' }}>No capabilities registered.</p>
      )}

      <table style={{ width: '100%', borderCollapse: 'collapse' }} data-testid="network-table">
        <thead>
          <tr style={{ borderBottom: '2px solid #e2e8f0', textAlign: 'left' }}>
            <th style={thStyle}>Agent</th>
            <th style={thStyle}>Task Type</th>
            <th style={thStyle}>Scope</th>
            <th style={thStyle}>Trust Score</th>
            <th style={thStyle}>Status</th>
          </tr>
        </thead>
        <tbody>
          {capabilities.map((cap) => {
            const trustScore = (cap.qualityMetrics?.trustScorePercentile as number) ?? 50;
            return (
              <tr key={cap.id} style={{ borderBottom: '1px solid #e2e8f0' }} data-testid={`cap-row-${cap.id}`}>
                <td style={tdStyle}>{cap.agentId}</td>
                <td style={tdStyle}>
                  {cap.taskType}
                  {cap.customType && <span style={{ color: '#888' }}> ({cap.customType})</span>}
                </td>
                <td style={tdStyle}>{cap.scope}</td>
                <td style={tdStyle}>
                  <span style={{ color: trustScore >= 70 ? '#22c55e' : trustScore >= 40 ? '#f59e0b' : '#ef4444' }}>
                    {trustScore}%
                  </span>
                </td>
                <td style={tdStyle}>
                  <span style={{ color: cap.enabled ? '#22c55e' : '#94a3b8' }}>
                    {cap.enabled ? 'Active' : 'Inactive'}
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  padding: '6px 10px', border: '1px solid #d1d5db', borderRadius: '4px', fontSize: '14px',
};
const thStyle: React.CSSProperties = { padding: '8px 12px', fontSize: '13px', color: '#64748b' };
const tdStyle: React.CSSProperties = { padding: '8px 12px', fontSize: '13px' };
