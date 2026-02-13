import React, { useState, useCallback } from 'react';
import { useApi } from '../hooks/useApi';
import { getMeshAgents, registerMeshAgent, unregisterMeshAgent, type MeshAgent } from '../api/discovery';

export default function CapabilityRegistry() {
  const [showForm, setShowForm] = useState(false);
  const agentsQuery = useApi(() => getMeshAgents(), []);
  const agents = agentsQuery.data ?? [];

  const handleUnregister = useCallback(async (name: string) => {
    if (!confirm(`Unregister agent "${name}"?`)) return;
    await unregisterMeshAgent(name);
    agentsQuery.refetch();
  }, [agentsQuery]);

  const handleRegister = useCallback(async (data: { name: string; description: string; capabilities: string[]; endpoint: string }) => {
    await registerMeshAgent(data);
    setShowForm(false);
    agentsQuery.refetch();
  }, [agentsQuery]);

  return (
    <div style={{ padding: '24px', maxWidth: '1200px', margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
        <h1 style={{ margin: 0, fontSize: '24px' }}>🤖 Agent Registry</h1>
        <button onClick={() => setShowForm(true)} style={btnStyle}>+ Register Agent</button>
      </div>

      {showForm && <RegisterForm onSubmit={handleRegister} onCancel={() => setShowForm(false)} />}

      {agentsQuery.loading && <p>Loading...</p>}
      {agentsQuery.error && <p style={{ color: '#ef4444' }}>Error: {agentsQuery.error}</p>}

      {!agentsQuery.loading && agents.length === 0 && (
        <p style={{ color: '#888' }}>No agents registered yet.</p>
      )}

      {agents.map((agent) => (
        <div key={agent.name} style={cardStyle}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <strong style={{ fontSize: '16px' }}>{agent.name}</strong>
              <p style={{ margin: '4px 0 0', fontSize: '13px', color: '#666' }}>{agent.description}</p>
            </div>
            <button onClick={() => handleUnregister(agent.name)} style={dangerBtnStyle}>✕ Remove</button>
          </div>
          <div style={{ marginTop: '8px', display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
            {agent.capabilities.map((cap) => (
              <span key={cap} style={tagStyle}>{cap}</span>
            ))}
          </div>
          <div style={{ marginTop: '8px', fontSize: '12px', color: '#888' }}>
            <span>Endpoint: {agent.endpoint}</span>
            <span style={{ marginLeft: '16px' }}>Protocol: {agent.protocol}</span>
            <span style={{ marginLeft: '16px' }}>Last seen: {new Date(agent.last_seen).toLocaleString()}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

function RegisterForm({ onSubmit, onCancel }: {
  onSubmit: (data: { name: string; description: string; capabilities: string[]; endpoint: string }) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [capabilities, setCapabilities] = useState('');
  const [endpoint, setEndpoint] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit({
      name,
      description,
      capabilities: capabilities.split(',').map(s => s.trim()).filter(Boolean),
      endpoint,
    });
  };

  return (
    <form onSubmit={handleSubmit} style={{ ...cardStyle, background: '#f8fafc' }}>
      <h3 style={{ margin: '0 0 12px' }}>Register New Agent</h3>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
        <label>Name<br /><input value={name} onChange={e => setName(e.target.value)} style={inputStyle} required /></label>
        <label>Endpoint<br /><input value={endpoint} onChange={e => setEndpoint(e.target.value)} style={inputStyle} required /></label>
        <label>Description<br /><input value={description} onChange={e => setDescription(e.target.value)} style={inputStyle} /></label>
        <label>Capabilities (comma-separated)<br /><input value={capabilities} onChange={e => setCapabilities(e.target.value)} style={inputStyle} /></label>
      </div>
      <div style={{ marginTop: '12px', display: 'flex', gap: '8px' }}>
        <button type="submit" style={btnStyle}>Register</button>
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
const dangerBtnStyle: React.CSSProperties = {
  padding: '4px 10px', background: 'transparent', border: '1px solid #fca5a5', color: '#dc2626',
  borderRadius: '4px', cursor: 'pointer', fontSize: '13px',
};
const tagStyle: React.CSSProperties = {
  padding: '2px 8px', background: '#e0f2fe', color: '#0369a1', borderRadius: '12px',
  fontSize: '12px', fontWeight: 500,
};
const inputStyle: React.CSSProperties = {
  width: '100%', padding: '6px 10px', border: '1px solid #d1d5db', borderRadius: '4px',
  fontSize: '14px', marginTop: '4px',
};
