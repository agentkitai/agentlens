import React, { useState, useCallback } from 'react';
import { useApi } from '../hooks/useApi';
import {
  getCapabilities,
  registerCapability,
  updateCapability,
  type CapabilityData,
} from '../api/client';

const TASK_TYPES = [
  'translation', 'summarization', 'code-review', 'data-extraction',
  'classification', 'generation', 'analysis', 'transformation', 'custom',
];

export default function CapabilityRegistry() {
  const [showForm, setShowForm] = useState(false);
  const capsQuery = useApi(() => getCapabilities(), []);
  const capabilities = capsQuery.data?.capabilities ?? [];

  const handleToggle = useCallback(async (cap: CapabilityData) => {
    await updateCapability(cap.id, { enabled: !cap.enabled });
    capsQuery.refetch();
  }, [capsQuery]);

  const handleRegister = useCallback(async (data: Partial<CapabilityData>) => {
    await registerCapability(data);
    setShowForm(false);
    capsQuery.refetch();
  }, [capsQuery]);

  return (
    <div style={{ padding: '24px', maxWidth: '1200px', margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
        <h1 style={{ margin: 0, fontSize: '24px' }}>📦 Capability Registry</h1>
        <button onClick={() => setShowForm(true)} style={btnStyle} data-testid="register-btn">+ Register</button>
      </div>

      {showForm && <RegisterForm onSubmit={handleRegister} onCancel={() => setShowForm(false)} />}

      {capsQuery.loading && <p>Loading...</p>}
      {capsQuery.error && <p style={{ color: '#ef4444' }}>Error: {capsQuery.error}</p>}

      {!capsQuery.loading && capabilities.length === 0 && (
        <p style={{ color: '#888' }}>No capabilities registered yet.</p>
      )}

      {capabilities.map((cap) => {
        const trustScore = (cap.qualityMetrics?.trustScorePercentile as number) ?? 50;
        return (
          <div key={cap.id} style={cardStyle} data-testid={`cap-${cap.id}`}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <strong>{cap.taskType}</strong>
                {cap.customType && <span style={{ color: '#888', marginLeft: '8px' }}>({cap.customType})</span>}
                {cap.description && <p style={{ margin: '4px 0 0', fontSize: '13px', color: '#666' }}>{cap.description}</p>}
              </div>
              <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                <span style={{ fontSize: '13px', color: '#64748b' }}>Trust: {trustScore}%</span>
                <button
                  onClick={() => handleToggle(cap)}
                  style={smallBtnStyle}
                  data-testid={`toggle-${cap.id}`}
                >
                  {cap.enabled ? '⏸ Disable' : '▶ Enable'}
                </button>
              </div>
            </div>
            <div style={{ marginTop: '8px', fontSize: '12px', color: '#888' }}>
              <span>Scope: {cap.scope}</span>
              <span style={{ marginLeft: '12px' }}>Agent: {cap.agentId}</span>
              {cap.estimatedCostUsd !== undefined && <span style={{ marginLeft: '12px' }}>Cost: ${cap.estimatedCostUsd}</span>}
              {cap.estimatedLatencyMs !== undefined && <span style={{ marginLeft: '12px' }}>Latency: {cap.estimatedLatencyMs}ms</span>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function RegisterForm({ onSubmit, onCancel }: {
  onSubmit: (data: Partial<CapabilityData>) => void;
  onCancel: () => void;
}) {
  const [taskType, setTaskType] = useState('custom');
  const [description, setDescription] = useState('');
  const [scope, setScope] = useState('internal');
  const [agentId, setAgentId] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit({
      taskType,
      description: description || undefined,
      scope,
      agentId: agentId || undefined,
      inputSchema: {},
      outputSchema: {},
      qualityMetrics: {},
    } as Partial<CapabilityData>);
  };

  return (
    <form onSubmit={handleSubmit} style={{ ...cardStyle, background: '#f8fafc' }} data-testid="register-form">
      <h3 style={{ margin: '0 0 12px' }}>Register New Capability</h3>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
        <label>Task Type<br />
          <select value={taskType} onChange={(e) => setTaskType(e.target.value)} style={inputStyle} data-testid="form-task-type">
            {TASK_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </label>
        <label>Agent ID<br />
          <input value={agentId} onChange={(e) => setAgentId(e.target.value)} style={inputStyle} data-testid="form-agent-id" />
        </label>
        <label>Description<br />
          <input value={description} onChange={(e) => setDescription(e.target.value)} style={inputStyle} data-testid="form-description" />
        </label>
        <label>Scope<br />
          <select value={scope} onChange={(e) => setScope(e.target.value)} style={inputStyle} data-testid="form-scope">
            <option value="internal">Internal</option>
            <option value="public">Public</option>
          </select>
        </label>
      </div>
      <div style={{ marginTop: '12px', display: 'flex', gap: '8px' }}>
        <button type="submit" style={btnStyle} data-testid="form-submit">Register</button>
        <button type="button" onClick={onCancel} style={smallBtnStyle}>Cancel</button>
      </div>
    </form>
  );
}

const cardStyle: React.CSSProperties = {
  padding: '16px', border: '1px solid #e2e8f0', borderRadius: '8px', marginBottom: '12px',
};
const btnStyle: React.CSSProperties = {
  padding: '8px 16px', background: '#3b82f6', color: 'white', border: 'none',
  borderRadius: '6px', cursor: 'pointer', fontSize: '14px',
};
const smallBtnStyle: React.CSSProperties = {
  padding: '4px 10px', background: 'transparent', border: '1px solid #d1d5db',
  borderRadius: '4px', cursor: 'pointer', fontSize: '13px',
};
const inputStyle: React.CSSProperties = {
  width: '100%', padding: '6px 10px', border: '1px solid #d1d5db', borderRadius: '4px',
  fontSize: '14px', marginTop: '4px',
};
