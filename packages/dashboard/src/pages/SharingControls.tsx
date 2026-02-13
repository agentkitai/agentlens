import React, { useState, useCallback } from 'react';
import { useApi } from '../hooks/useApi';
import {
  getSharingConfig,
  updateSharingConfig,
  getAgentSharingConfigs,
  updateAgentSharingConfig,
  getDenyList,
  addDenyListRule,
  deleteDenyListRule,
  getSharingStats,
  killSwitchPurge,
  type SharingConfigData,
  type AgentSharingConfigData,
  type DenyListRuleData,
} from '../api/client';

const CATEGORIES = [
  'model-performance',
  'error-patterns',
  'tool-usage',
  'cost-optimization',
  'prompt-engineering',
  'general',
];

export default function SharingControls() {
  const configQuery = useApi(() => getSharingConfig(), []);
  const agentsQuery = useApi(() => getAgentSharingConfigs(), []);
  const denyListQuery = useApi(() => getDenyList(), []);
  const statsQuery = useApi(() => getSharingStats(), []);

  const [showKillSwitch, setShowKillSwitch] = useState(false);
  const [killSwitchConfirm, setKillSwitchConfirm] = useState('');
  const [newPattern, setNewPattern] = useState('');
  const [newPatternRegex, setNewPatternRegex] = useState(false);
  const [newPatternReason, setNewPatternReason] = useState('');

  const config = configQuery.data;
  const agents = agentsQuery.data?.configs ?? [];
  const denyRules = denyListQuery.data?.rules ?? [];
  const stats = statsQuery.data;

  const handleToggleEnabled = useCallback(async () => {
    if (!config) return;
    await updateSharingConfig({ enabled: !config.enabled });
    configQuery.refetch();
  }, [config, configQuery]);

  const handleKillSwitch = useCallback(async () => {
    if (killSwitchConfirm !== 'PURGE') return;
    await killSwitchPurge('PURGE');
    setShowKillSwitch(false);
    setKillSwitchConfirm('');
    configQuery.refetch();
    statsQuery.refetch();
  }, [killSwitchConfirm, configQuery, statsQuery]);

  const handleAddDenyRule = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newPattern) return;
    await addDenyListRule({ pattern: newPattern, isRegex: newPatternRegex, reason: newPatternReason });
    setNewPattern('');
    setNewPatternReason('');
    setNewPatternRegex(false);
    denyListQuery.refetch();
  }, [newPattern, newPatternRegex, newPatternReason, denyListQuery]);

  const handleDeleteDenyRule = useCallback(async (id: string) => {
    await deleteDenyListRule(id);
    denyListQuery.refetch();
  }, [denyListQuery]);

  if (configQuery.loading) return <div>Loading...</div>;

  return (
    <div style={{ padding: '24px', maxWidth: '1200px', margin: '0 auto' }}>
      <h1 style={{ margin: '0 0 24px', fontSize: '24px' }}>🔗 Sharing Controls</h1>

      {/* Tenant Toggle */}
      <div style={cardStyle}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <strong>Tenant Sharing</strong>
            <p style={{ margin: '4px 0 0', color: '#666', fontSize: '13px' }}>Enable or disable sharing for the entire tenant</p>
          </div>
          <button
            onClick={handleToggleEnabled}
            data-testid="tenant-toggle"
            style={{ ...btnStyle, background: config?.enabled ? '#22c55e' : '#94a3b8' }}
          >
            {config?.enabled ? 'Enabled' : 'Disabled'}
          </button>
        </div>
      </div>

      {/* Category Toggles */}
      <div style={cardStyle}>
        <strong>Category Toggles</strong>
        <div style={{ marginTop: '12px', display: 'flex', flexWrap: 'wrap', gap: '12px' }}>
          {CATEGORIES.map((cat) => (
            <label key={cat} style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '14px' }}>
              <input type="checkbox" data-testid={`category-${cat}`} defaultChecked />
              {cat}
            </label>
          ))}
        </div>
      </div>

      {/* Per-Agent Configs */}
      <div style={cardStyle}>
        <strong>Per-Agent Sharing Config</strong>
        {agents.length === 0 && <p style={{ color: '#888', fontSize: '13px' }}>No agent configs found.</p>}
        {agents.map((agent) => (
          <div key={agent.agentId} style={{ padding: '8px 0', borderBottom: '1px solid #e2e8f0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span>{agent.agentId}</span>
            <span style={{ color: agent.enabled ? '#22c55e' : '#94a3b8', fontSize: '13px' }}>
              {agent.enabled ? 'Sharing' : 'Not sharing'} — {agent.categories.length} categories
            </span>
          </div>
        ))}
      </div>

      {/* Deny List */}
      <div style={cardStyle}>
        <strong>Deny List</strong>
        <form onSubmit={handleAddDenyRule} style={{ display: 'flex', gap: '8px', marginTop: '12px' }}>
          <input
            value={newPattern}
            onChange={(e) => setNewPattern(e.target.value)}
            placeholder="Pattern..."
            data-testid="deny-pattern-input"
            style={inputStyle}
          />
          <input
            value={newPatternReason}
            onChange={(e) => setNewPatternReason(e.target.value)}
            placeholder="Reason..."
            style={inputStyle}
          />
          <label style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '13px' }}>
            <input type="checkbox" checked={newPatternRegex} onChange={(e) => setNewPatternRegex(e.target.checked)} />
            Regex
          </label>
          <button type="submit" style={btnStyle} data-testid="add-deny-rule">Add</button>
        </form>
        {denyRules.map((rule) => (
          <div key={rule.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: '1px solid #eee' }}>
            <span style={{ fontSize: '13px' }}>
              <code>{rule.pattern}</code> {rule.isRegex && '(regex)'} — {rule.reason}
            </span>
            <button onClick={() => handleDeleteDenyRule(rule.id)} style={smallBtnStyle} data-testid={`delete-deny-${rule.id}`}>🗑</button>
          </div>
        ))}
      </div>

      {/* Sharing Status */}
      <div style={cardStyle}>
        <strong>Sharing Status</strong>
        {stats && (
          <div style={{ marginTop: '8px', fontSize: '14px' }}>
            <p>Lessons shared: <strong>{stats.countShared}</strong></p>
            <p>Last shared: <strong>{stats.lastShared ?? 'Never'}</strong></p>
            {stats.auditSummary && (
              <div>
                <p>Audit summary:</p>
                {Object.entries(stats.auditSummary).map(([k, v]) => (
                  <span key={k} style={{ marginRight: '12px' }}>{k}: {v}</span>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Kill Switch */}
      <div style={{ ...cardStyle, borderColor: '#fca5a5' }}>
        <strong style={{ color: '#ef4444' }}>⚠️ Kill Switch</strong>
        <p style={{ fontSize: '13px', color: '#666' }}>Purge all shared data and disable sharing immediately.</p>
        {!showKillSwitch ? (
          <button onClick={() => setShowKillSwitch(true)} style={{ ...btnStyle, background: '#ef4444' }} data-testid="kill-switch-btn">
            Activate Kill Switch
          </button>
        ) : (
          <div style={{ marginTop: '8px' }}>
            <p style={{ fontSize: '13px', color: '#ef4444' }}>Type PURGE to proceed:</p>
            <input
              value={killSwitchConfirm}
              onChange={(e) => setKillSwitchConfirm(e.target.value)}
              placeholder="PURGE"
              data-testid="kill-switch-confirm"
              style={inputStyle}
            />
            <button onClick={handleKillSwitch} style={{ ...btnStyle, background: '#ef4444', marginTop: '8px' }} data-testid="kill-switch-execute">
              Purge All Data
            </button>
          </div>
        )}
      </div>
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
const smallBtnStyle: React.CSSProperties = {
  padding: '4px 10px', background: 'transparent', border: '1px solid #d1d5db',
  borderRadius: '4px', cursor: 'pointer', fontSize: '13px',
};
const inputStyle: React.CSSProperties = {
  padding: '6px 10px', border: '1px solid #d1d5db', borderRadius: '4px', fontSize: '14px',
};
