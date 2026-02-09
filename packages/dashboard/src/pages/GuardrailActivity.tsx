import React, { useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useApi } from '../hooks/useApi';
import {
  getGuardrailRules,
  getGuardrailHistory,
  type GuardrailRuleData,
  type GuardrailTriggerData,
} from '../api/client';

// ─── Helpers ────────────────────────────────────────────────────

function formatTimestamp(ts: string): string {
  try { return new Date(ts).toLocaleString(); } catch { return ts; }
}

// ─── Main Page ──────────────────────────────────────────────────

export default function GuardrailActivity() {
  const [filterAgent, setFilterAgent] = useState('');
  const [filterRule, setFilterRule] = useState('');

  const rulesQuery = useApi(() => getGuardrailRules(), []);
  const historyQuery = useApi(() => getGuardrailHistory({ limit: 200 }), []);

  const rules = rulesQuery.data?.rules ?? [];
  const triggers = historyQuery.data?.triggers ?? [];

  // Build lookup maps
  const ruleMap = useMemo(() => {
    const m = new Map<string, GuardrailRuleData>();
    for (const r of rules) m.set(r.id, r);
    return m;
  }, [rules]);

  // Extract unique agents from rules
  const agents = useMemo(() => {
    const set = new Set<string>();
    for (const r of rules) if (r.agentId) set.add(r.agentId);
    return Array.from(set).sort();
  }, [rules]);

  // Filter triggers
  const filtered = useMemo(() => {
    return triggers.filter((t) => {
      const rule = ruleMap.get(t.ruleId);
      if (!rule) return false;
      if (filterRule && t.ruleId !== filterRule) return false;
      if (filterAgent && rule.agentId !== filterAgent) return false;
      return true;
    });
  }, [triggers, ruleMap, filterRule, filterAgent]);

  return (
    <div style={{ padding: '24px', maxWidth: '1200px', margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
        <h1 style={{ margin: 0, fontSize: '24px' }}>🛡️ Guardrail Activity Feed</h1>
        <Link to="/guardrails" style={{ color: '#3b82f6', textDecoration: 'none', fontSize: '14px' }}>← Back to Rules</Link>
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: '12px', marginBottom: '16px', flexWrap: 'wrap' }}>
        <select value={filterRule} onChange={e => setFilterRule(e.target.value)} style={selectStyle}>
          <option value="">All Rules</option>
          {rules.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
        </select>
        <select value={filterAgent} onChange={e => setFilterAgent(e.target.value)} style={selectStyle}>
          <option value="">All Agents</option>
          {agents.map(a => <option key={a} value={a}>{a}</option>)}
        </select>
      </div>

      {(rulesQuery.loading || historyQuery.loading) && <p>Loading...</p>}
      {historyQuery.error && <p style={{ color: '#ef4444' }}>Error: {historyQuery.error}</p>}

      {filtered.length === 0 && !historyQuery.loading && (
        <p style={{ color: '#888' }}>No guardrail triggers found.</p>
      )}

      {filtered.length > 0 && (
        <table style={{ width: '100%', borderCollapse: 'collapse', background: 'white', borderRadius: '8px', overflow: 'hidden' }}>
          <thead>
            <tr style={{ borderBottom: '2px solid #e2e8f0', textAlign: 'left' }}>
              <th style={thStyle}>Timestamp</th>
              <th style={thStyle}>Rule</th>
              <th style={thStyle}>Agent</th>
              <th style={thStyle}>Condition</th>
              <th style={thStyle}>Action</th>
              <th style={thStyle}>Dry Run</th>
              <th style={thStyle}>Value / Threshold</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((t) => {
              const rule = ruleMap.get(t.ruleId);
              return (
                <tr key={t.id} style={{ borderBottom: '1px solid #e2e8f0' }}>
                  <td style={tdStyle}>{formatTimestamp(t.triggeredAt)}</td>
                  <td style={tdStyle}>
                    <Link to={`/guardrails/${t.ruleId}`} style={{ color: '#3b82f6', textDecoration: 'none' }}>
                      {rule?.name ?? t.ruleId}
                    </Link>
                  </td>
                  <td style={tdStyle}>{rule?.agentId ?? <span style={{ color: '#aaa' }}>All</span>}</td>
                  <td style={tdStyle}>{rule?.conditionType ?? '—'}</td>
                  <td style={tdStyle}>{rule?.actionType ?? '—'}</td>
                  <td style={tdStyle}>
                    {t.actionExecuted
                      ? <span style={{ color: '#22c55e', fontSize: '11px', fontWeight: 600 }}>LIVE</span>
                      : <span style={{ background: '#fef3c7', color: '#92400e', padding: '1px 6px', borderRadius: '8px', fontSize: '11px', fontWeight: 600 }}>DRY RUN</span>}
                  </td>
                  <td style={tdStyle}>{t.conditionValue} / {t.conditionThreshold}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}

// ─── Styles ─────────────────────────────────────────────────────

const selectStyle: React.CSSProperties = {
  padding: '6px 10px', border: '1px solid #d1d5db', borderRadius: '4px', fontSize: '14px',
};

const thStyle: React.CSSProperties = { padding: '10px 12px', fontSize: '13px', color: '#64748b', fontWeight: 600 };
const tdStyle: React.CSSProperties = { padding: '10px 12px', fontSize: '13px' };

export { GuardrailActivity };
