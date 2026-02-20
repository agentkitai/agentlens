/**
 * Budget Configuration Page (Feature 5 — Story 7)
 *
 * Full budget management: list, create, edit, delete.
 * Also includes anomaly detection configuration.
 */

import React, { useState, useCallback } from 'react';
import { useApi } from '../hooks/useApi';
import {
  listBudgets,
  createBudget,
  updateBudget,
  deleteBudget,
  getBudgetStatus,
  getAnomalyConfig,
  updateAnomalyConfig,
  type CostBudgetData,
  type CreateCostBudgetData,
  type CostBudgetStatusData,
  type CostAnomalyConfigData,
  type CostBudgetScope,
  type CostBudgetPeriod,
  type CostBudgetOnBreach,
} from '../api/budgets';

// ─── Constants ──────────────────────────────────────────────

const SCOPE_OPTIONS: { value: CostBudgetScope; label: string }[] = [
  { value: 'session', label: 'Session' },
  { value: 'agent', label: 'Agent' },
];

const PERIOD_OPTIONS: { value: CostBudgetPeriod; label: string; scopes: CostBudgetScope[] }[] = [
  { value: 'session', label: 'Per Session', scopes: ['session'] },
  { value: 'daily', label: 'Daily', scopes: ['agent'] },
  { value: 'weekly', label: 'Weekly', scopes: ['agent'] },
  { value: 'monthly', label: 'Monthly', scopes: ['agent'] },
];

const BREACH_OPTIONS: { value: CostBudgetOnBreach; label: string }[] = [
  { value: 'alert', label: 'Alert Only' },
  { value: 'pause_agent', label: 'Pause Agent' },
  { value: 'downgrade_model', label: 'Downgrade Model' },
];

type Tab = 'budgets' | 'anomaly';

function formatTimestamp(ts: string): string {
  try { return new Date(ts).toLocaleString(); } catch { return ts; }
}

// ─── Main Page ──────────────────────────────────────────────

export default function BudgetConfig() {
  const [tab, setTab] = useState<Tab>('budgets');
  const [showForm, setShowForm] = useState(false);
  const [editingBudget, setEditingBudget] = useState<CostBudgetData | null>(null);
  const [statusMap, setStatusMap] = useState<Record<string, CostBudgetStatusData>>({});

  const budgetsQuery = useApi(() => listBudgets(), []);
  const anomalyQuery = useApi(() => getAnomalyConfig(), []);

  const budgets = budgetsQuery.data?.budgets ?? [];

  const handleCreate = useCallback(async (data: CreateCostBudgetData) => {
    await createBudget(data);
    setShowForm(false);
    setEditingBudget(null);
    budgetsQuery.refetch();
  }, [budgetsQuery]);

  const handleUpdate = useCallback(async (id: string, data: Partial<CreateCostBudgetData>) => {
    await updateBudget(id, data);
    setShowForm(false);
    setEditingBudget(null);
    budgetsQuery.refetch();
  }, [budgetsQuery]);

  const handleDelete = useCallback(async (id: string) => {
    if (!confirm('Delete this budget?')) return;
    await deleteBudget(id);
    budgetsQuery.refetch();
  }, [budgetsQuery]);

  const handleToggle = useCallback(async (budget: CostBudgetData) => {
    await updateBudget(budget.id, { enabled: !budget.enabled });
    budgetsQuery.refetch();
  }, [budgetsQuery]);

  const handleEdit = useCallback((budget: CostBudgetData) => {
    setEditingBudget(budget);
    setShowForm(true);
  }, []);

  const handleViewStatus = useCallback(async (id: string) => {
    try {
      const status = await getBudgetStatus(id);
      setStatusMap((prev) => ({ ...prev, [id]: status }));
    } catch { /* ignore */ }
  }, []);

  const handleAnomalyUpdate = useCallback(async (data: { multiplier?: number; minSessions?: number; enabled?: boolean }) => {
    await updateAnomalyConfig(data);
    anomalyQuery.refetch();
  }, [anomalyQuery]);

  return (
    <div style={{ padding: '24px', maxWidth: '1200px', margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
        <h1 style={{ margin: 0, fontSize: '24px' }}>💰 Cost Budgets</h1>
        {tab === 'budgets' && (
          <button onClick={() => { setEditingBudget(null); setShowForm(true); }} style={btnStyle}>+ New Budget</button>
        )}
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: '8px', marginBottom: '16px' }}>
        <button onClick={() => setTab('budgets')} style={tab === 'budgets' ? tabActiveStyle : tabStyle}>
          Budgets ({budgets.length})
        </button>
        <button onClick={() => setTab('anomaly')} style={tab === 'anomaly' ? tabActiveStyle : tabStyle}>
          Anomaly Detection
        </button>
      </div>

      {/* Budget Form */}
      {showForm && tab === 'budgets' && (
        <BudgetForm
          budget={editingBudget}
          onSubmit={editingBudget
            ? (data) => handleUpdate(editingBudget.id, data)
            : handleCreate
          }
          onCancel={() => { setShowForm(false); setEditingBudget(null); }}
        />
      )}

      {/* Budgets Tab */}
      {tab === 'budgets' && (
        <div>
          {budgets.length === 0 && <p style={{ color: '#888' }}>No cost budgets configured yet.</p>}
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            {budgets.length > 0 && (
              <thead>
                <tr style={{ borderBottom: '2px solid #e2e8f0', textAlign: 'left' }}>
                  <th style={thStyle}>Scope</th>
                  <th style={thStyle}>Agent</th>
                  <th style={thStyle}>Period</th>
                  <th style={thStyle}>Limit</th>
                  <th style={thStyle}>On Breach</th>
                  <th style={thStyle}>Enabled</th>
                  <th style={thStyle}>Status</th>
                  <th style={thStyle}>Actions</th>
                </tr>
              </thead>
            )}
            <tbody>
              {budgets.map((b) => {
                const status = statusMap[b.id];
                return (
                  <tr key={b.id} style={{ borderBottom: '1px solid #e2e8f0' }}>
                    <td style={tdStyle}>{b.scope}</td>
                    <td style={tdStyle}>{b.agentId || '—'}</td>
                    <td style={tdStyle}>{b.period}</td>
                    <td style={tdStyle}>${b.limitUsd.toFixed(2)}</td>
                    <td style={tdStyle}>{b.onBreach.replace('_', ' ')}</td>
                    <td style={tdStyle}>
                      <span style={{ color: b.enabled ? '#22c55e' : '#94a3b8' }}>
                        {b.enabled ? '● On' : '○ Off'}
                      </span>
                    </td>
                    <td style={tdStyle}>
                      {status ? (
                        <BudgetStatusBadge currentSpend={status.currentSpend} limitUsd={status.limitUsd} />
                      ) : (
                        <button onClick={() => handleViewStatus(b.id)} style={linkBtnStyle}>View</button>
                      )}
                    </td>
                    <td style={tdStyle}>
                      <div style={{ display: 'flex', gap: '4px' }}>
                        <button onClick={() => handleToggle(b)} style={smallBtnStyle}>
                          {b.enabled ? '⏸' : '▶'}
                        </button>
                        <button onClick={() => handleEdit(b)} style={smallBtnStyle}>✏️</button>
                        <button onClick={() => handleDelete(b.id)} style={{ ...smallBtnStyle, color: '#ef4444' }}>🗑</button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Anomaly Tab */}
      {tab === 'anomaly' && (
        <AnomalyConfigPanel config={anomalyQuery.data ?? null} onSave={handleAnomalyUpdate} />
      )}
    </div>
  );
}

// ─── Budget Status Badge ────────────────────────────────────

export function BudgetStatusBadge({ currentSpend, limitUsd }: { currentSpend: number; limitUsd: number }) {
  const pct = limitUsd > 0 ? Math.min((currentSpend / limitUsd) * 100, 100) : 0;
  const color = pct >= 100 ? '#ef4444' : pct >= 80 ? '#f59e0b' : '#22c55e';

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: '140px' }}>
      <div style={{ flex: 1, height: '8px', background: '#e2e8f0', borderRadius: '4px', overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: '4px', transition: 'width 0.3s' }} />
      </div>
      <span style={{ fontSize: '11px', color: '#64748b', whiteSpace: 'nowrap' }}>
        ${currentSpend.toFixed(2)} / ${limitUsd.toFixed(2)}
      </span>
    </div>
  );
}

// ─── Budget Form ────────────────────────────────────────────

function BudgetForm({ budget, onSubmit, onCancel }: {
  budget: CostBudgetData | null;
  onSubmit: (data: CreateCostBudgetData) => void;
  onCancel: () => void;
}) {
  const [scope, setScope] = useState<CostBudgetScope>(budget?.scope ?? 'session');
  const [agentId, setAgentId] = useState(budget?.agentId ?? '');
  const [period, setPeriod] = useState<CostBudgetPeriod>(budget?.period ?? 'session');
  const [limitUsd, setLimitUsd] = useState(String(budget?.limitUsd ?? '1.00'));
  const [onBreach, setOnBreach] = useState<CostBudgetOnBreach>(budget?.onBreach ?? 'alert');
  const [downgradeTargetModel, setDowngradeTargetModel] = useState(budget?.downgradeTargetModel ?? '');
  const [enabled, setEnabled] = useState(budget?.enabled ?? true);

  const availablePeriods = PERIOD_OPTIONS.filter((p) => p.scopes.includes(scope));

  // Auto-fix period when scope changes
  const handleScopeChange = (newScope: CostBudgetScope) => {
    setScope(newScope);
    if (newScope === 'session') {
      setPeriod('session');
    } else if (period === 'session') {
      setPeriod('daily');
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const data: CreateCostBudgetData = {
      scope,
      period,
      limitUsd: Number(limitUsd),
      onBreach,
      enabled,
    };
    if (scope === 'agent' && agentId) data.agentId = agentId;
    if (onBreach === 'downgrade_model' && downgradeTargetModel) data.downgradeTargetModel = downgradeTargetModel;
    onSubmit(data);
  };

  return (
    <form onSubmit={handleSubmit} style={{ ...cardStyle, marginBottom: '16px', background: '#f8fafc' }}>
      <h3 style={{ margin: '0 0 12px' }}>{budget ? 'Edit Budget' : 'New Budget'}</h3>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
        <label>Scope<br />
          <select value={scope} onChange={(e) => handleScopeChange(e.target.value as CostBudgetScope)} style={inputStyle}>
            {SCOPE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </label>
        {scope === 'agent' && (
          <label>Agent ID<br />
            <input value={agentId} onChange={(e) => setAgentId(e.target.value)} required style={inputStyle} placeholder="e.g. my-agent" />
          </label>
        )}
        <label>Period<br />
          <select value={period} onChange={(e) => setPeriod(e.target.value as CostBudgetPeriod)} style={inputStyle}>
            {availablePeriods.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </label>
        <label>Limit (USD)<br />
          <input type="number" step="0.01" min="0.01" value={limitUsd} onChange={(e) => setLimitUsd(e.target.value)} required style={inputStyle} />
        </label>
        <label>On Breach<br />
          <select value={onBreach} onChange={(e) => setOnBreach(e.target.value as CostBudgetOnBreach)} style={inputStyle}>
            {BREACH_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </label>
        {onBreach === 'downgrade_model' && (
          <label>Target Model<br />
            <input value={downgradeTargetModel} onChange={(e) => setDowngradeTargetModel(e.target.value)} required style={inputStyle} placeholder="e.g. gpt-4o-mini" />
          </label>
        )}
        <label style={{ display: 'flex', alignItems: 'center', gap: '8px', paddingTop: '20px' }}>
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} /> Enabled
        </label>
      </div>
      <div style={{ marginTop: '12px', display: 'flex', gap: '8px' }}>
        <button type="submit" style={btnStyle}>{budget ? 'Update' : 'Create'}</button>
        <button type="button" onClick={onCancel} style={smallBtnStyle}>Cancel</button>
      </div>
    </form>
  );
}

// ─── Anomaly Config Panel (Story 9) ────────────────────────

function AnomalyConfigPanel({ config, onSave }: {
  config: CostAnomalyConfigData | null;
  onSave: (data: { multiplier?: number; minSessions?: number; enabled?: boolean }) => void;
}) {
  const [multiplier, setMultiplier] = useState(String(config?.multiplier ?? 3.0));
  const [minSessions, setMinSessions] = useState(String(config?.minSessions ?? 5));
  const [enabled, setEnabled] = useState(config?.enabled ?? true);
  const [saved, setSaved] = useState(false);

  // Sync if config loads after mount
  React.useEffect(() => {
    if (config) {
      setMultiplier(String(config.multiplier));
      setMinSessions(String(config.minSessions));
      setEnabled(config.enabled);
    }
  }, [config]);

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    onSave({ multiplier: Number(multiplier), minSessions: Number(minSessions), enabled });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <form onSubmit={handleSave} style={cardStyle}>
      <h3 style={{ margin: '0 0 4px' }}>🔍 Anomaly Detection Settings</h3>
      <p style={{ color: '#64748b', fontSize: '13px', margin: '0 0 16px' }}>
        Flag sessions whose cost exceeds a multiplier of the 7-day rolling average for the same agent.
      </p>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '12px', maxWidth: '600px' }}>
        <label>
          Multiplier (×)<br />
          <input type="number" step="0.5" min="1.5" max="20" value={multiplier} onChange={(e) => setMultiplier(e.target.value)} style={inputStyle} />
        </label>
        <label>
          Min Sessions<br />
          <input type="number" min="1" max="100" value={minSessions} onChange={(e) => setMinSessions(e.target.value)} style={inputStyle} />
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: '8px', paddingTop: '20px' }}>
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} /> Enabled
        </label>
      </div>
      <div style={{ marginTop: '12px', display: 'flex', gap: '8px', alignItems: 'center' }}>
        <button type="submit" style={btnStyle}>Save</button>
        {saved && <span style={{ color: '#22c55e', fontSize: '13px' }}>✓ Saved</span>}
      </div>
      {config && (
        <p style={{ color: '#94a3b8', fontSize: '12px', marginTop: '8px' }}>
          Last updated: {formatTimestamp(config.updatedAt)}
        </p>
      )}
    </form>
  );
}

// ─── Styles ─────────────────────────────────────────────────

const btnStyle: React.CSSProperties = {
  padding: '8px 16px', background: '#3b82f6', color: 'white', border: 'none',
  borderRadius: '6px', cursor: 'pointer', fontSize: '14px',
};

const smallBtnStyle: React.CSSProperties = {
  padding: '4px 10px', background: 'transparent', border: '1px solid #d1d5db',
  borderRadius: '4px', cursor: 'pointer', fontSize: '13px',
};

const linkBtnStyle: React.CSSProperties = {
  padding: '2px 6px', background: 'transparent', border: 'none',
  color: '#3b82f6', cursor: 'pointer', fontSize: '12px', textDecoration: 'underline',
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
