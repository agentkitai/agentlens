import React, { useState } from 'react';
import { useApi } from '../hooks/useApi';
import { getMeshAgents, discoverAgents, type MeshAgent } from '../api/discovery';

export default function AgentNetwork() {
  const [searchQuery, setSearchQuery] = useState('');
  const agentsQuery = useApi(() => getMeshAgents(), []);
  const agents = agentsQuery.data ?? [];

  const [searchResults, setSearchResults] = useState<{ agent: MeshAgent; score: number; matchedTerms: string[] }[] | null>(null);

  const handleSearch = async () => {
    if (!searchQuery.trim()) { setSearchResults(null); return; }
    const resp = await discoverAgents({ query: searchQuery.trim() });
    setSearchResults(resp.results as { agent: MeshAgent; score: number; matchedTerms: string[] }[]);
  };

  const displayAgents = searchResults
    ? searchResults.map(r => r.agent)
    : agents;

  return (
    <div style={{ padding: '24px', maxWidth: '1200px', margin: '0 auto' }}>
      <h1 style={{ margin: '0 0 24px', fontSize: '24px' }}>🌐 Agent Network</h1>

      <div style={{ display: 'flex', gap: '8px', marginBottom: '16px' }}>
        <input
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
          placeholder="Discover by capability (e.g. coding, fitness)..."
          style={inputStyle}
        />
        <button onClick={handleSearch} style={btnStyle}>🔍 Discover</button>
        {searchResults && (
          <button onClick={() => { setSearchResults(null); setSearchQuery(''); }} style={smallBtnStyle}>Clear</button>
        )}
      </div>

      {agentsQuery.loading && <p>Loading...</p>}
      {agentsQuery.error && <p style={{ color: '#ef4444' }}>Error: {agentsQuery.error}</p>}

      {searchResults && <p style={{ color: '#888', fontSize: '13px', marginBottom: '8px' }}>{searchResults.length} result(s) for "{searchQuery}"</p>}

      {!agentsQuery.loading && displayAgents.length === 0 && (
        <p style={{ color: '#888' }}>No agents found.</p>
      )}

      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ borderBottom: '2px solid #e2e8f0', textAlign: 'left' }}>
            <th style={thStyle}>Agent</th>
            <th style={thStyle}>Description</th>
            <th style={thStyle}>Capabilities</th>
            <th style={thStyle}>Protocol</th>
            <th style={thStyle}>Last Seen</th>
          </tr>
        </thead>
        <tbody>
          {displayAgents.map((agent) => (
            <tr key={agent.name} style={{ borderBottom: '1px solid #e2e8f0' }}>
              <td style={tdStyle}><strong>{agent.name}</strong></td>
              <td style={tdStyle}>{agent.description}</td>
              <td style={tdStyle}>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                  {agent.capabilities.map(c => (
                    <span key={c} style={tagStyle}>{c}</span>
                  ))}
                </div>
              </td>
              <td style={tdStyle}>{agent.protocol}</td>
              <td style={tdStyle}>{new Date(agent.last_seen).toLocaleString()}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  padding: '6px 10px', border: '1px solid #d1d5db', borderRadius: '4px', fontSize: '14px', flex: 1,
};
const btnStyle: React.CSSProperties = {
  padding: '6px 16px', background: '#3b82f6', color: 'white', border: 'none',
  borderRadius: '6px', cursor: 'pointer', fontSize: '14px',
};
const smallBtnStyle: React.CSSProperties = {
  padding: '6px 10px', background: 'transparent', border: '1px solid #d1d5db',
  borderRadius: '4px', cursor: 'pointer', fontSize: '13px',
};
const thStyle: React.CSSProperties = { padding: '8px 12px', fontSize: '13px', color: '#64748b' };
const tdStyle: React.CSSProperties = { padding: '8px 12px', fontSize: '13px' };
const tagStyle: React.CSSProperties = {
  padding: '1px 6px', background: '#e0f2fe', color: '#0369a1', borderRadius: '10px',
  fontSize: '11px', fontWeight: 500,
};
