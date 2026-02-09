import React from 'react';
import { Link, useParams } from 'react-router-dom';
import { useApi } from '../hooks/useApi';
import {
  getGuardrailStatus,
  type GuardrailRuleData,
  type GuardrailTriggerData,
} from '../api/client';

// ─── Helpers ────────────────────────────────────────────────────

function formatTimestamp(ts: string): string {
  try { return new Date(ts).toLocaleString(); } catch { return ts; }
}

function conditionLabel(type: string): string {
  const map: Record<string, string> = {
    error_rate_threshold: 'Error Rate Threshold',
    cost_limit: 'Cost Limit',
    health_score_threshold: 'Health Score Threshold',
    custom_metric: 'Custom Metric',
  };
  return map[type] ?? type;
}

function actionLabel(type: string): string {
  const map: Record<string, string> = {
    pause_agent: '⏸ Pause Agent',
    notify_webhook: '🔔 Notify Webhook',
    downgrade_model: '⬇ Downgrade Model',
    agentgate_policy: '🚪 AgentGate Policy',
  };
  return map[type] ?? type;
}

function renderConfig(config: Record<string, unknown>): React.ReactNode {
  const entries = Object.entries(config);
  if (entries.length === 0) return <span style={{ color: '#aaa' }}>—</span>;
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 16px', fontSize: '13px' }}>
      {entries.map(([k, v]) => (
        <React.Fragment key={k}>
          <span style={{ color: '#64748b', fontWeight: 500 }}>{k}</span>
          <span>{typeof v === 'object' ? JSON.stringify(v) : String(v)}</span>
        </React.Fragment>
      ))}
    </div>
  );
}

// ─── Main Page ──────────────────────────────────────────────────

export default function GuardrailDetail() {
  const { id } = useParams<{ id: string }>();

  if (!id) return <p>No guardrail ID specified</p>;

  const query = useApi(
    () => getGuardrailStatus(id!),
    [id],
  );

  const rule = query.data?.rule;
  const state = query.data?.state;
  const triggers = query.data?.recentTriggers ?? [];

  if (query.loading) return <div style={{ padding: '24px' }}>Loading...</div>;
  if (query.error) return <div style={{ padding: '24px', color: '#ef4444' }}>Error: {query.error}</div>;
  if (!rule) return <div style={{ padding: '24px' }}>Rule not found.</div>;

  return (
    <div style={{ padding: '24px', maxWidth: '1000px', margin: '0 auto' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
        <div>
          <Link to="/guardrails" style={{ color: '#3b82f6', textDecoration: 'none', fontSize: '13px' }}>← Back to Guardrails</Link>
          <h1 style={{ margin: '8px 0 0', fontSize: '24px' }}>
            🛡️ {rule.name}
            {rule.dryRun && <span style={{ color: '#f59e0b', marginLeft: '8px', fontSize: '14px' }}>[DRY RUN]</span>}
            {!rule.enabled && <span style={{ color: '#9ca3af', marginLeft: '8px', fontSize: '14px' }}>[DISABLED]</span>}
          </h1>
        </div>
        <Link to={`/guardrails/${rule.id}/edit`} style={btnStyle}>✏️ Edit</Link>
      </div>

      {/* Rule Configuration */}
      <div style={sectionStyle}>
        <h3 style={sectionTitleStyle}>Rule Configuration</h3>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
          <div>
            <div style={labelStyle}>Name</div>
            <div>{rule.name}</div>
          </div>
          <div>
            <div style={labelStyle}>Agent</div>
            <div>{rule.agentId ?? <span style={{ color: '#aaa' }}>All Agents</span>}</div>
          </div>
          <div>
            <div style={labelStyle}>Enabled</div>
            <div>{rule.enabled ? '✅ Yes' : '❌ No'}</div>
          </div>
          <div>
            <div style={labelStyle}>Dry Run</div>
            <div>{rule.dryRun ? '🔸 Yes' : 'No'}</div>
          </div>
          <div>
            <div style={labelStyle}>Cooldown</div>
            <div>{rule.cooldownMinutes} minutes</div>
          </div>
          <div>
            <div style={labelStyle}>Created</div>
            <div>{formatTimestamp(rule.createdAt)}</div>
          </div>
        </div>
      </div>

      {/* Condition */}
      <div style={sectionStyle}>
        <h3 style={sectionTitleStyle}>Condition — {conditionLabel(rule.conditionType)}</h3>
        {renderConfig(rule.conditionConfig)}
      </div>

      {/* Action */}
      <div style={sectionStyle}>
        <h3 style={sectionTitleStyle}>Action — {actionLabel(rule.actionType)}</h3>
        {renderConfig(rule.actionConfig)}
      </div>

      {/* State */}
      <div style={sectionStyle}>
        <h3 style={sectionTitleStyle}>Runtime State</h3>
        {state ? (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '16px' }}>
            <div>
              <div style={labelStyle}>Trigger Count</div>
              <div style={{ fontSize: '20px', fontWeight: 600 }}>{state.triggerCount}</div>
            </div>
            <div>
              <div style={labelStyle}>Last Triggered</div>
              <div>{state.lastTriggeredAt ? formatTimestamp(state.lastTriggeredAt) : '—'}</div>
            </div>
            <div>
              <div style={labelStyle}>Current Value</div>
              <div>{state.currentValue !== undefined ? state.currentValue : '—'}</div>
            </div>
          </div>
        ) : (
          <p style={{ color: '#aaa' }}>No state data — rule has not been evaluated yet.</p>
        )}
      </div>

      {/* Trigger History */}
      <div style={sectionStyle}>
        <h3 style={sectionTitleStyle}>Trigger History (Recent)</h3>
        {triggers.length === 0 ? (
          <p style={{ color: '#aaa' }}>No triggers recorded yet.</p>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '2px solid #e2e8f0', textAlign: 'left' }}>
                <th style={thStyle}>Timestamp</th>
                <th style={thStyle}>Value</th>
                <th style={thStyle}>Threshold</th>
                <th style={thStyle}>Action Executed</th>
                <th style={thStyle}>Result</th>
              </tr>
            </thead>
            <tbody>
              {triggers.map((t) => (
                <tr key={t.id} style={{ borderBottom: '1px solid #e2e8f0' }}>
                  <td style={tdStyle}>{formatTimestamp(t.triggeredAt)}</td>
                  <td style={tdStyle}>{t.conditionValue}</td>
                  <td style={tdStyle}>{t.conditionThreshold}</td>
                  <td style={tdStyle}>
                    {t.actionExecuted
                      ? <span style={{ color: '#22c55e' }}>✓ Yes</span>
                      : <span style={{ color: '#f59e0b' }}>Dry Run</span>}
                  </td>
                  <td style={tdStyle}>{t.actionResult ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

// ─── Styles ─────────────────────────────────────────────────────

const btnStyle: React.CSSProperties = {
  padding: '8px 16px', background: '#3b82f6', color: 'white', border: 'none',
  borderRadius: '6px', cursor: 'pointer', fontSize: '14px', textDecoration: 'none',
  display: 'inline-block',
};

const sectionStyle: React.CSSProperties = {
  padding: '16px', border: '1px solid #e2e8f0', borderRadius: '8px', marginBottom: '16px',
  background: 'white',
};

const sectionTitleStyle: React.CSSProperties = { margin: '0 0 12px', fontSize: '16px', color: '#334155' };
const labelStyle: React.CSSProperties = { fontSize: '12px', color: '#64748b', fontWeight: 600, marginBottom: '4px', textTransform: 'uppercase' as const };
const thStyle: React.CSSProperties = { padding: '8px 12px', fontSize: '12px', color: '#64748b', fontWeight: 600 };
const tdStyle: React.CSSProperties = { padding: '8px 12px', fontSize: '13px' };

export { GuardrailDetail };
