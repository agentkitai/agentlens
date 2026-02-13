import React from 'react';
import { useApi } from '../hooks/useApi';
import { getMeshDelegations, type MeshDelegation } from '../api/delegations';

export default function DelegationLog() {
  const query = useApi(() => getMeshDelegations({ limit: 50 }), []);
  const delegations = query.data?.delegations ?? [];

  const statusColor = (status: string) => {
    if (status === 'success') return '#16a34a';
    if (status === 'error') return '#dc2626';
    return '#d97706';
  };

  return (
    <div style={{ padding: '24px', maxWidth: '1200px', margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
        <h1 style={{ margin: 0, fontSize: '24px' }}>📋 Delegation Log</h1>
        <button onClick={() => query.refetch()} style={btnStyle}>↻ Refresh</button>
      </div>

      {query.loading && <p>Loading...</p>}
      {query.error && <p style={{ color: '#ef4444' }}>Error: {query.error}</p>}

      {!query.loading && delegations.length === 0 && (
        <p style={{ color: '#888' }}>No delegations recorded yet. Delegations appear here when agents delegate tasks to each other via the mesh.</p>
      )}

      {delegations.map((d) => (
        <div key={d.id} style={cardStyle}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <strong>{d.source_agent}</strong>
              <span style={{ margin: '0 8px', color: '#888' }}>→</span>
              <strong>{d.target_agent}</strong>
            </div>
            <span style={{ color: statusColor(d.status), fontWeight: 600, fontSize: '13px' }}>
              {d.status.toUpperCase()}
            </span>
          </div>
          <p style={{ margin: '6px 0 0', fontSize: '13px', color: '#374151' }}>{d.task}</p>
          {d.error && <p style={{ margin: '4px 0 0', fontSize: '12px', color: '#dc2626' }}>Error: {d.error}</p>}
          <div style={{ marginTop: '8px', fontSize: '12px', color: '#888' }}>
            {d.latency_ms != null && <span>Latency: {d.latency_ms}ms</span>}
            <span style={{ marginLeft: d.latency_ms != null ? '16px' : '0' }}>
              {new Date(d.created_at).toLocaleString()}
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}

const cardStyle: React.CSSProperties = {
  padding: '16px', border: '1px solid #e2e8f0', borderRadius: '8px', marginBottom: '12px',
};
const btnStyle: React.CSSProperties = {
  padding: '8px 16px', background: '#3b82f6', color: 'white', border: 'none',
  borderRadius: '6px', cursor: 'pointer', fontSize: '14px',
};
