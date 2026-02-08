import React, { useState, useCallback } from 'react';
import { useApi } from '../hooks/useApi';
import {
  getGuardrailRules,
  getGuardrailHistory,
  createGuardrailRule,
  updateGuardrailRule,
  deleteGuardrailRule,
  type GuardrailRuleData,
  type GuardrailTriggerData,
  type CreateGuardrailData,
} from '../api/client';

// ─── Constants ──────────────────────────────────────────────────

const CONDITION_OPTIONS = [
  { value: 'error_rate_threshold', label: 'Error Rate Threshold' },
  { value: 'cost_limit', label: 'Cost Limit' },
  { value: 'health_score_threshold', label: 'Health Score Threshold' },
  { value: 'custom_metric', label: 'Custom Metric' },
];

const ACTION_OPTIONS = [
  { value: 'pause_agent', label: 'Pause Agent' },
  { value: 'notify_webhook', label: 'Notify Webhook' },
  { value: 'downgrade_model', label: 'Downgrade Model' },
  { value: 'agentgate_policy', label: 'AgentGate Policy' },
];

type Tab = 'rules' | 'history';

function formatTimestamp(ts: string): string {
  try { return new Date(ts).toLocaleString(); } catch { return ts; }
}

// ─── Main Page ──────────────────────────────────────────────────

export default function Guardrails() {
  const [tab, setTab] = useState<Tab>('rules');
  const [showCreate, setShowCreate] = useState(false);

  const rulesQuery = useApi(() => getGuardrailRules(), []);
  const historyQuery = useApi(() => getGuardrailHistory({ limit: 50 }), []);

  const rules = rulesQuery.data?.rules ?? [];
  const triggers = historyQuery.data?.triggers ?? [];

  const handleCreate = useCallback(async (data: CreateGuardrailData) => {
    await createGuardrailRule(data);
    setShowCreate(false);
    rulesQuery.refetch();
  }, [rulesQuery]);

  const handleToggle = useCallback(async (rule: GuardrailRuleData) => {
    await updateGuardrailRule(rule.id, { enabled: !rule.enabled });
    rulesQuery.refetch();
  }, [rulesQuery]);

  const handleDelete = useCallback(async (id: string) => {
    if (!confirm('Delete this guardrail rule?')) return;
    await deleteGuardrailRule(id);
    rulesQuery.refetch();
    historyQuery.refetch();
  }, [rulesQuery, historyQuery]);

  return (
    <div style={{ padding: '24px', maxWidth: '1200px', margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
        <h1 style={{ margin: 0, fontSize: '24px' }}>🛡️ Guardrails</h1>
        <button onClick={() => setShowCreate(true)} style={btnStyle}>+ New Rule</button>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: '8px', marginBottom: '16px' }}>
        <button onClick={() => setTab('rules')} style={tab === 'rules' ? tabActiveStyle : tabStyle}>
          Rules ({rules.length})
        </button>
        <button onClick={() => setTab('history')} style={tab === 'history' ? tabActiveStyle : tabStyle}>
          Trigger History ({historyQuery.data?.total ?? 0})
        </button>
      </div>

      {/* Create Form */}
      {showCreate && <CreateForm onSubmit={handleCreate} onCancel={() => setShowCreate(false)} />}

      {/* Rules Tab */}
      {tab === 'rules' && (
        <div>
          {rules.length === 0 && <p style={{ color: '#888' }}>No guardrail rules configured yet.</p>}
          {rules.map((rule) => (
            <RuleCard key={rule.id} rule={rule} onToggle={handleToggle} onDelete={handleDelete} />
          ))}
        </div>
      )}

      {/* History Tab */}
      {tab === 'history' && (
        <div>
          {triggers.length === 0 && <p style={{ color: '#888' }}>No triggers recorded yet.</p>}
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '2px solid #e2e8f0', textAlign: 'left' }}>
                <th style={thStyle}>Time</th>
                <th style={thStyle}>Rule</th>
                <th style={thStyle}>Value</th>
                <th style={thStyle}>Threshold</th>
                <th style={thStyle}>Result</th>
              </tr>
            </thead>
            <tbody>
              {triggers.map((t) => (
                <tr key={t.id} style={{ borderBottom: '1px solid #e2e8f0' }}>
                  <td style={tdStyle}>{formatTimestamp(t.triggeredAt)}</td>
                  <td style={tdStyle}>{t.ruleId.slice(0, 8)}...</td>
                  <td style={tdStyle}>{t.conditionValue.toFixed(2)}</td>
                  <td style={tdStyle}>{t.conditionThreshold}</td>
                  <td style={tdStyle}>
                    <span style={{ color: t.actionExecuted ? '#22c55e' : '#f59e0b' }}>
                      {t.actionResult ?? 'unknown'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ─── Sub-components ─────────────────────────────────────────────

function RuleCard({ rule, onToggle, onDelete }: {
  rule: GuardrailRuleData;
  onToggle: (r: GuardrailRuleData) => void;
  onDelete: (id: string) => void;
}) {
  return (
    <div style={cardStyle}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <strong>{rule.name}</strong>
          {rule.dryRun && <span style={{ color: '#f59e0b', marginLeft: '8px', fontSize: '12px' }}>[DRY RUN]</span>}
          {rule.description && <p style={{ color: '#888', margin: '4px 0 0', fontSize: '13px' }}>{rule.description}</p>}
        </div>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <button onClick={() => onToggle(rule)} style={smallBtnStyle}>
            {rule.enabled ? '⏸ Disable' : '▶ Enable'}
          </button>
          <button onClick={() => onDelete(rule.id)} style={{ ...smallBtnStyle, color: '#ef4444' }}>
            🗑
          </button>
        </div>
      </div>
      <div style={{ marginTop: '8px', fontSize: '13px', color: '#666' }}>
        <span>Condition: <strong>{rule.conditionType}</strong></span>
        <span style={{ margin: '0 12px' }}>→</span>
        <span>Action: <strong>{rule.actionType}</strong></span>
        <span style={{ marginLeft: '12px' }}>Cooldown: {rule.cooldownMinutes}min</span>
        {rule.agentId && <span style={{ marginLeft: '12px' }}>Agent: {rule.agentId}</span>}
      </div>
    </div>
  );
}

function CreateForm({ onSubmit, onCancel }: {
  onSubmit: (data: CreateGuardrailData) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState('');
  const [conditionType, setConditionType] = useState('error_rate_threshold');
  const [actionType, setActionType] = useState('pause_agent');
  const [threshold, setThreshold] = useState('30');
  const [cooldown, setCooldown] = useState('15');
  const [dryRun, setDryRun] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const conditionConfig: Record<string, unknown> = {};
    if (conditionType === 'error_rate_threshold') {
      conditionConfig.threshold = Number(threshold);
      conditionConfig.windowMinutes = 5;
    } else if (conditionType === 'cost_limit') {
      conditionConfig.maxCostUsd = Number(threshold);
      conditionConfig.scope = 'daily';
    } else if (conditionType === 'health_score_threshold') {
      conditionConfig.minScore = Number(threshold);
    }

    onSubmit({
      name,
      conditionType,
      conditionConfig,
      actionType,
      actionConfig: {},
      cooldownMinutes: Number(cooldown),
      dryRun,
    });
  };

  return (
    <form onSubmit={handleSubmit} style={{ ...cardStyle, marginBottom: '16px', background: '#f8fafc' }}>
      <h3 style={{ margin: '0 0 12px' }}>New Guardrail Rule</h3>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
        <label>Name<br /><input value={name} onChange={(e) => setName(e.target.value)} required style={inputStyle} /></label>
        <label>Condition<br />
          <select value={conditionType} onChange={(e) => setConditionType(e.target.value)} style={inputStyle}>
            {CONDITION_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </label>
        <label>Threshold<br /><input type="number" value={threshold} onChange={(e) => setThreshold(e.target.value)} style={inputStyle} /></label>
        <label>Action<br />
          <select value={actionType} onChange={(e) => setActionType(e.target.value)} style={inputStyle}>
            {ACTION_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </label>
        <label>Cooldown (min)<br /><input type="number" value={cooldown} onChange={(e) => setCooldown(e.target.value)} style={inputStyle} /></label>
        <label style={{ display: 'flex', alignItems: 'center', gap: '8px', paddingTop: '20px' }}>
          <input type="checkbox" checked={dryRun} onChange={(e) => setDryRun(e.target.checked)} /> Dry Run
        </label>
      </div>
      <div style={{ marginTop: '12px', display: 'flex', gap: '8px' }}>
        <button type="submit" style={btnStyle}>Create</button>
        <button type="button" onClick={onCancel} style={smallBtnStyle}>Cancel</button>
      </div>
    </form>
  );
}

// ─── Styles ─────────────────────────────────────────────────────

const btnStyle: React.CSSProperties = {
  padding: '8px 16px', background: '#3b82f6', color: 'white', border: 'none',
  borderRadius: '6px', cursor: 'pointer', fontSize: '14px',
};

const smallBtnStyle: React.CSSProperties = {
  padding: '4px 10px', background: 'transparent', border: '1px solid #d1d5db',
  borderRadius: '4px', cursor: 'pointer', fontSize: '13px',
};

const tabStyle: React.CSSProperties = {
  padding: '8px 16px', background: 'transparent', border: '1px solid #d1d5db',
  borderRadius: '6px', cursor: 'pointer', fontSize: '14px',
};

const tabActiveStyle: React.CSSProperties = {
  ...tabStyle, background: '#3b82f6', color: 'white', borderColor: '#3b82f6',
};

const cardStyle: React.CSSProperties = {
  padding: '16px', border: '1px solid #e2e8f0', borderRadius: '8px', marginBottom: '12px',
};

const thStyle: React.CSSProperties = { padding: '8px 12px', fontSize: '13px', color: '#64748b' };
const tdStyle: React.CSSProperties = { padding: '8px 12px', fontSize: '13px' };

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '6px 10px', border: '1px solid #d1d5db', borderRadius: '4px',
  fontSize: '14px', marginTop: '4px',
};
