import React, { useState, useCallback } from 'react';
import { useApi } from '../hooks/useApi';
import {
  getAlertRules,
  getAlertHistory,
  createAlertRule,
  updateAlertRule,
  deleteAlertRule,
  type AlertRuleData,
  type AlertHistoryEntry,
  type CreateAlertRuleData,
} from '../api/client';

// ─── Constants ──────────────────────────────────────────────────

const CONDITION_OPTIONS = [
  { value: 'error_rate_exceeds', label: 'Error rate exceeds', unit: '(ratio 0-1)' },
  { value: 'cost_exceeds', label: 'Cost exceeds', unit: '(USD)' },
  { value: 'latency_exceeds', label: 'Latency exceeds', unit: '(ms)' },
  { value: 'event_count_exceeds', label: 'Event count exceeds', unit: '(count)' },
  { value: 'no_events_for', label: 'No events for', unit: '(window)' },
] as const;

const WINDOW_OPTIONS = [
  { value: 5, label: '5 minutes' },
  { value: 15, label: '15 minutes' },
  { value: 30, label: '30 minutes' },
  { value: 60, label: '1 hour' },
  { value: 360, label: '6 hours' },
  { value: 1440, label: '24 hours' },
];

type Tab = 'active' | 'rules' | 'history';

// ─── Sub-components ─────────────────────────────────────────────

function conditionLabel(condition: string): string {
  const found = CONDITION_OPTIONS.find((c) => c.value === condition);
  return found ? found.label : condition;
}

function formatTimestamp(ts: string): string {
  try {
    return new Date(ts).toLocaleString();
  } catch {
    return ts;
  }
}

function formatValue(condition: string, value: number): string {
  switch (condition) {
    case 'error_rate_exceeds':
      return `${(value * 100).toFixed(1)}%`;
    case 'cost_exceeds':
      return `$${value.toFixed(2)}`;
    case 'latency_exceeds':
      return `${value.toFixed(0)}ms`;
    default:
      return value.toString();
  }
}

// ─── Create Rule Form ───────────────────────────────────────────

interface CreateRuleFormProps {
  onCreated: () => void;
  onCancel: () => void;
}

function CreateRuleForm({ onCreated, onCancel }: CreateRuleFormProps): React.ReactElement {
  const [name, setName] = useState('');
  const [condition, setCondition] = useState('error_rate_exceeds');
  const [threshold, setThreshold] = useState('0.1');
  const [windowMinutes, setWindowMinutes] = useState(60);
  const [webhookUrl, setWebhookUrl] = useState('');
  const [agentId, setAgentId] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSaving(true);

    try {
      const data: CreateAlertRuleData = {
        name,
        condition,
        threshold: parseFloat(threshold),
        windowMinutes,
        notifyChannels: webhookUrl ? [webhookUrl] : [],
        scope: agentId ? { agentId } : {},
      };
      await createAlertRule(data);
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create rule');
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4 rounded-lg border border-gray-200 bg-white p-6">
      <h3 className="text-lg font-semibold text-gray-900">Create Alert Rule</h3>

      {error && (
        <div className="rounded-md bg-red-50 p-3 text-sm text-red-700">{error}</div>
      )}

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Name</label>
        <input
          type="text"
          required
          className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g., High Error Rate Alert"
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Condition</label>
          <select
            className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            value={condition}
            onChange={(e) => setCondition(e.target.value)}
          >
            {CONDITION_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label} {opt.unit}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Threshold</label>
          <input
            type="number"
            required
            step="any"
            min="0"
            className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            value={threshold}
            onChange={(e) => setThreshold(e.target.value)}
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Window</label>
          <select
            className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            value={windowMinutes}
            onChange={(e) => setWindowMinutes(parseInt(e.target.value, 10))}
          >
            {WINDOW_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          Agent ID <span className="text-gray-400">(optional — leave blank for all agents)</span>
        </label>
        <input
          type="text"
          className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          value={agentId}
          onChange={(e) => setAgentId(e.target.value)}
          placeholder="my-agent"
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          Webhook URL <span className="text-gray-400">(optional)</span>
        </label>
        <input
          type="url"
          className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          value={webhookUrl}
          onChange={(e) => setWebhookUrl(e.target.value)}
          placeholder="https://hooks.slack.com/services/..."
        />
      </div>

      <div className="flex gap-3 pt-2">
        <button
          type="submit"
          disabled={saving}
          className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {saving ? 'Creating...' : 'Create Rule'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

// ─── Rule Row ───────────────────────────────────────────────────

interface RuleRowProps {
  rule: AlertRuleData;
  onToggle: (id: string, enabled: boolean) => void;
  onDelete: (id: string) => void;
}

function RuleRow({ rule, onToggle, onDelete }: RuleRowProps): React.ReactElement {
  return (
    <tr className="hover:bg-gray-50">
      <td className="px-4 py-3 text-sm font-medium text-gray-900">{rule.name}</td>
      <td className="px-4 py-3 text-sm text-gray-600">{conditionLabel(rule.condition)}</td>
      <td className="px-4 py-3 text-sm text-gray-600">
        {formatValue(rule.condition, rule.threshold)}
      </td>
      <td className="px-4 py-3 text-sm text-gray-600">{rule.windowMinutes}m</td>
      <td className="px-4 py-3">
        <button
          onClick={() => onToggle(rule.id, !rule.enabled)}
          className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
            rule.enabled
              ? 'bg-green-100 text-green-800'
              : 'bg-gray-100 text-gray-600'
          }`}
        >
          {rule.enabled ? 'Enabled' : 'Disabled'}
        </button>
      </td>
      <td className="px-4 py-3 text-sm text-gray-500">
        {rule.notifyChannels.length > 0 ? `${rule.notifyChannels.length} channel(s)` : '—'}
      </td>
      <td className="px-4 py-3">
        <button
          onClick={() => onDelete(rule.id)}
          className="text-sm text-red-600 hover:text-red-800"
        >
          Delete
        </button>
      </td>
    </tr>
  );
}

// ─── Main Alerts Component ──────────────────────────────────────

export function Alerts(): React.ReactElement {
  const [tab, setTab] = useState<Tab>('rules');
  const [showCreate, setShowCreate] = useState(false);

  const rules = useApi(() => getAlertRules(), []);
  const history = useApi(
    () => getAlertHistory({ limit: 50 }),
    [],
  );

  const handleToggle = useCallback(
    async (id: string, enabled: boolean) => {
      try {
        await updateAlertRule(id, { enabled });
        rules.refetch();
      } catch (err) {
        console.error('Failed to toggle rule:', err);
      }
    },
    [rules],
  );

  const handleDelete = useCallback(
    async (id: string) => {
      if (!confirm('Delete this alert rule?')) return;
      try {
        await deleteAlertRule(id);
        rules.refetch();
      } catch (err) {
        console.error('Failed to delete rule:', err);
      }
    },
    [rules],
  );

  const handleCreated = useCallback(() => {
    setShowCreate(false);
    rules.refetch();
  }, [rules]);

  // Compute active alerts (recent history entries that are unresolved)
  const activeAlerts =
    history.data?.entries.filter((e) => !e.resolvedAt) ?? [];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Alerts</h1>
        <button
          onClick={() => setShowCreate(!showCreate)}
          className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
        >
          {showCreate ? 'Cancel' : '+ Create Rule'}
        </button>
      </div>

      {/* Active Alerts Banner */}
      {activeAlerts.length > 0 && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-red-800 mb-2">
            <span>🔴</span> Active Alerts ({activeAlerts.length})
          </h2>
          <div className="space-y-2">
            {activeAlerts.slice(0, 5).map((alert) => (
              <div
                key={alert.id}
                className="flex items-center justify-between text-sm text-red-700"
              >
                <span>{alert.message}</span>
                <span className="text-xs text-red-500">
                  {formatTimestamp(alert.triggeredAt)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Create Rule Form */}
      {showCreate && (
        <CreateRuleForm
          onCreated={handleCreated}
          onCancel={() => setShowCreate(false)}
        />
      )}

      {/* Tabs */}
      <div className="border-b border-gray-200">
        <nav className="-mb-px flex gap-6">
          {(
            [
              { key: 'rules' as Tab, label: 'Rules' },
              { key: 'history' as Tab, label: 'History' },
            ] as const
          ).map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`pb-3 text-sm font-medium border-b-2 transition-colors ${
                tab === t.key
                  ? 'border-blue-600 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              {t.label}
            </button>
          ))}
        </nav>
      </div>

      {/* Rules Tab */}
      {tab === 'rules' && (
        <div className="rounded-lg border border-gray-200 bg-white overflow-hidden">
          {rules.loading ? (
            <div className="py-12 text-center text-gray-500">Loading rules...</div>
          ) : rules.error ? (
            <div className="py-12 text-center text-red-500">Error: {rules.error}</div>
          ) : (rules.data ?? []).length === 0 ? (
            <div className="py-12 text-center">
              <div className="text-4xl mb-3">🔔</div>
              <p className="text-gray-500">No alert rules configured.</p>
              <button
                onClick={() => setShowCreate(true)}
                className="mt-3 text-sm text-blue-600 hover:text-blue-800"
              >
                Create your first rule →
              </button>
            </div>
          ) : (
            <table className="w-full">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">
                    Name
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">
                    Condition
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">
                    Threshold
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">
                    Window
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">
                    Status
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">
                    Channels
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {(rules.data ?? []).map((rule) => (
                  <RuleRow
                    key={rule.id}
                    rule={rule}
                    onToggle={handleToggle}
                    onDelete={handleDelete}
                  />
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* History Tab */}
      {tab === 'history' && (
        <div className="rounded-lg border border-gray-200 bg-white overflow-hidden">
          {history.loading ? (
            <div className="py-12 text-center text-gray-500">Loading history...</div>
          ) : history.error ? (
            <div className="py-12 text-center text-red-500">Error: {history.error}</div>
          ) : (history.data?.entries ?? []).length === 0 ? (
            <div className="py-12 text-center">
              <div className="text-4xl mb-3">📜</div>
              <p className="text-gray-500">No alert history yet.</p>
            </div>
          ) : (
            <table className="w-full">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">
                    Triggered
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">
                    Message
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">
                    Value
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">
                    Threshold
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">
                    Status
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {(history.data?.entries ?? []).map((entry) => (
                  <tr key={entry.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 text-sm text-gray-600">
                      {formatTimestamp(entry.triggeredAt)}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-900">{entry.message}</td>
                    <td className="px-4 py-3 text-sm text-gray-600">
                      {entry.currentValue.toFixed(4)}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-600">
                      {entry.threshold.toFixed(4)}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
                          entry.resolvedAt
                            ? 'bg-green-100 text-green-800'
                            : 'bg-red-100 text-red-800'
                        }`}
                      >
                        {entry.resolvedAt ? 'Resolved' : 'Active'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}
