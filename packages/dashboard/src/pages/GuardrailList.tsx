import { getErrorMessage } from '@agentlensai/core';
import React, { Suspense, useState, useCallback } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useApi } from '../hooks/useApi';
import { PageSkeleton } from '../components/PageSkeleton';
import {
  getGuardrailRules,
  getGuardrailHistory,
  updateGuardrailRule,
  deleteGuardrailRule,
  type GuardrailRuleData,
} from '../api/client';

const GuardrailActivity = React.lazy(() => import('./GuardrailActivity'));

// ─── Helpers ────────────────────────────────────────────────────

function formatTimestamp(ts: string): string {
  try { return new Date(ts).toLocaleString(); } catch { return ts; }
}

function summarizeConditions(rule: GuardrailRuleData): string {
  const { conditionType, conditionConfig } = rule;
  switch (conditionType) {
    case 'error_rate_threshold':
      return `Error rate > ${conditionConfig.threshold ?? '?'}%`;
    case 'cost_limit':
      return `Cost > $${conditionConfig.maxCostUsd ?? '?'} (${conditionConfig.scope ?? 'daily'})`;
    case 'health_score_threshold':
      return `Health < ${conditionConfig.minScore ?? '?'}`;
    case 'custom_metric':
      return `${conditionConfig.metricKey ?? '?'} ${conditionConfig.operator ?? '?'} ${conditionConfig.value ?? '?'}`;
    default:
      return conditionType;
  }
}

function summarizeActions(rule: GuardrailRuleData): string {
  const { actionType, actionConfig } = rule;
  switch (actionType) {
    case 'pause_agent': return '⏸ Pause Agent';
    case 'notify_webhook': return `🔔 Webhook: ${actionConfig.url ?? '?'}`;
    case 'downgrade_model': return `⬇ Downgrade → ${actionConfig.targetModel ?? '?'}`;
    case 'agentgate_policy': return `🚪 Policy: ${actionConfig.policyId ?? '?'}`;
    default: return actionType;
  }
}

// ─── Main Page ──────────────────────────────────────────────────

function GuardrailRules() {
  const rulesQuery = useApi(() => getGuardrailRules(), []);
  const historyQuery = useApi(() => getGuardrailHistory({ limit: 200 }), []);

  const rules = rulesQuery.data?.rules ?? [];
  const triggers = historyQuery.data?.triggers ?? [];

  // Build trigger count and last triggered maps
  const triggerCountMap = new Map<string, number>();
  const lastTriggeredMap = new Map<string, string>();
  for (const t of triggers) {
    triggerCountMap.set(t.ruleId, (triggerCountMap.get(t.ruleId) ?? 0) + 1);
    const prev = lastTriggeredMap.get(t.ruleId);
    if (!prev || t.triggeredAt > prev) {
      lastTriggeredMap.set(t.ruleId, t.triggeredAt);
    }
  }

  const [actionError, setActionError] = useState<string | null>(null);

  const handleToggle = useCallback(async (rule: GuardrailRuleData) => {
    try {
      setActionError(null);
      await updateGuardrailRule(rule.id, { enabled: !rule.enabled });
      rulesQuery.refetch();
    } catch (err: unknown) {
      setActionError(`Failed to toggle rule: ${getErrorMessage(err) ?? String(err)}`);
    }
  }, [rulesQuery]);

  const handleDelete = useCallback(async (id: string) => {
    if (!confirm('Delete this guardrail rule? This action cannot be undone.')) return;
    try {
      setActionError(null);
      await deleteGuardrailRule(id);
      rulesQuery.refetch();
      historyQuery.refetch();
    } catch (err: unknown) {
      setActionError(`Failed to delete rule: ${getErrorMessage(err) ?? String(err)}`);
    }
  }, [rulesQuery, historyQuery]);

  return (
    <div style={{ padding: '24px', maxWidth: '1200px', margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
        <h1 style={{ margin: 0, fontSize: '24px' }}>🛡️ Guardrails</h1>
        <Link to="/guardrails/new" style={btnStyle}>+ Create Rule</Link>
      </div>

      {actionError && <p style={{ color: '#ef4444', padding: '8px', background: '#fef2f2', borderRadius: '4px', marginBottom: '12px' }}>{actionError}</p>}
      {rulesQuery.loading && <p>Loading...</p>}
      {rulesQuery.error && <p style={{ color: '#ef4444' }}>Error: {String(rulesQuery.error)}</p>}

      {!rulesQuery.loading && rules.length === 0 && (
        <p style={{ color: '#888' }}>No guardrail rules configured yet. <Link to="/guardrails/new">Create one</Link>.</p>
      )}

      {rules.length > 0 && (
        <table style={{ width: '100%', borderCollapse: 'collapse', background: 'white', borderRadius: '8px', overflow: 'hidden' }}>
          <thead>
            <tr style={{ borderBottom: '2px solid #e2e8f0', textAlign: 'left' }}>
              <th style={thStyle}>Name</th>
              <th style={thStyle}>Agent</th>
              <th style={thStyle}>Condition</th>
              <th style={thStyle}>Action</th>
              <th style={thStyle}>Enabled</th>
              <th style={thStyle}>Last Triggered</th>
              <th style={thStyle}>Triggers</th>
              <th style={thStyle}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {rules.map((rule) => (
              <tr key={rule.id} style={{ borderBottom: '1px solid #e2e8f0' }}>
                <td style={tdStyle}>
                  <Link to={`/guardrails/${rule.id}`} style={{ color: '#3b82f6', textDecoration: 'none', fontWeight: 500 }}>
                    {rule.name}
                  </Link>
                  {rule.dryRun && <span style={{ color: '#f59e0b', marginLeft: '6px', fontSize: '11px' }}>[DRY RUN]</span>}
                </td>
                <td style={tdStyle}>{rule.agentId ?? <span style={{ color: '#aaa' }}>All</span>}</td>
                <td style={tdStyle}>{summarizeConditions(rule)}</td>
                <td style={tdStyle}>{summarizeActions(rule)}</td>
                <td style={tdStyle}>
                  <button
                    onClick={() => handleToggle(rule)}
                    style={{
                      ...toggleStyle,
                      background: rule.enabled ? '#22c55e' : '#d1d5db',
                    }}
                    title={rule.enabled ? 'Click to disable' : 'Click to enable'}
                  >
                    {rule.enabled ? 'ON' : 'OFF'}
                  </button>
                </td>
                <td style={tdStyle}>
                  {lastTriggeredMap.get(rule.id) ? formatTimestamp(lastTriggeredMap.get(rule.id)!) : '—'}
                </td>
                <td style={tdStyle}>{triggerCountMap.get(rule.id) ?? 0}</td>
                <td style={tdStyle}>
                  <button onClick={() => handleDelete(rule.id)} style={deleteBtnStyle} title="Delete rule">
                    🗑
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

// ─── Styles ─────────────────────────────────────────────────────

const btnStyle: React.CSSProperties = {
  padding: '8px 16px', background: '#3b82f6', color: 'white', border: 'none',
  borderRadius: '6px', cursor: 'pointer', fontSize: '14px', textDecoration: 'none',
  display: 'inline-block',
};

const thStyle: React.CSSProperties = { padding: '10px 12px', fontSize: '13px', color: '#64748b', fontWeight: 600 };
const tdStyle: React.CSSProperties = { padding: '10px 12px', fontSize: '13px' };

const toggleStyle: React.CSSProperties = {
  padding: '2px 10px', color: 'white', border: 'none', borderRadius: '12px',
  cursor: 'pointer', fontSize: '11px', fontWeight: 600,
};

const deleteBtnStyle: React.CSSProperties = {
  padding: '4px 8px', background: 'transparent', border: '1px solid #fca5a5',
  borderRadius: '4px', cursor: 'pointer', fontSize: '13px',
};

type GuardrailTab = 'rules' | 'activity';

function GuardrailList() {
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = (searchParams.get('tab') as GuardrailTab) || 'rules';

  return (
    <div>
      <div className="flex gap-1 border-b border-gray-200 mb-6">
        {([
          { key: 'rules' as const, label: 'Rules' },
          { key: 'activity' as const, label: 'Activity' },
        ]).map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setSearchParams(key === 'rules' ? {} : { tab: key })}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              activeTab === key
                ? 'border-brand-600 text-brand-700'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
          >
            {label}
          </button>
        ))}
      </div>
      {activeTab === 'rules' && <GuardrailRules />}
      {activeTab === 'activity' && <Suspense fallback={<PageSkeleton />}><GuardrailActivity /></Suspense>}
    </div>
  );
}

export default GuardrailList;
export { GuardrailList };
