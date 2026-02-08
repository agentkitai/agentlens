/**
 * Settings Page (Stories 8.3 & 8.4)
 *
 * Route: /settings
 *
 * Tab 1 — API Keys:
 *   - List existing keys: name, created date, last used, scopes
 *   - "Create Key" → form for name + scopes
 *   - On creation: show raw key ONCE with Copy button + warning
 *   - "Revoke" button with confirmation dialog
 *
 * Tab 2 — Configuration:
 *   - Retention days, integration webhooks (display-only for MVP)
 */

import React, { useState } from 'react';
import type { StorageStats } from '@agentlensai/core';
import {
  getKeys,
  createKey,
  revokeKey,
  getStats,
  getConfig,
  updateConfig,
  type ApiKeyInfo,
  type ApiKeyCreated,
  type ConfigData,
} from '../api/client';
import { useApi } from '../hooks/useApi';

// ─── Tab type ───────────────────────────────────────────────

type SettingsTab = 'keys' | 'config' | 'integrations';

// ─── API Key Scopes ─────────────────────────────────────────

const AVAILABLE_SCOPES = [
  '*',
  'events:write',
  'events:read',
  'sessions:read',
  'agents:read',
  'stats:read',
] as const;
type Scope = (typeof AVAILABLE_SCOPES)[number];

// ─── Create Key Form ────────────────────────────────────────

interface CreateKeyFormProps {
  onCreated: (response: ApiKeyCreated) => void;
  onCancel: () => void;
}

function CreateKeyForm({ onCreated, onCancel }: CreateKeyFormProps): React.ReactElement {
  const [name, setName] = useState('');
  const [scopes, setScopes] = useState<Scope[]>(['*']);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggleScope = (scope: Scope) => {
    if (scope === '*') {
      setScopes(['*']);
      return;
    }
    const without = scopes.filter((s) => s !== '*' && s !== scope);
    if (scopes.includes(scope)) {
      setScopes(without.length === 0 ? ['*'] : without);
    } else {
      setScopes([...without, scope]);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      const resp = await createKey(name.trim(), scopes);
      onCreated(resp);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4 rounded-lg border border-indigo-200 bg-indigo-50 p-4">
      <h3 className="font-semibold text-gray-900">Create API Key</h3>

      <div>
        <label htmlFor="key-name" className="block text-sm font-medium text-gray-700">
          Key Name
        </label>
        <input
          id="key-name"
          type="text"
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. production-agent"
          className="mt-1 w-full rounded border border-gray-300 px-3 py-1.5 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
        />
      </div>

      <div>
        <span className="block text-sm font-medium text-gray-700">Scopes</span>
        <div className="mt-1 flex flex-wrap gap-2">
          {AVAILABLE_SCOPES.map((scope) => (
            <label
              key={scope}
              className={`flex cursor-pointer items-center gap-1.5 rounded-full border px-3 py-1 text-xs ${
                scopes.includes(scope)
                  ? 'border-indigo-300 bg-indigo-100 text-indigo-700'
                  : 'border-gray-200 bg-white text-gray-600'
              }`}
            >
              <input
                type="checkbox"
                checked={scopes.includes(scope)}
                onChange={() => toggleScope(scope)}
                className="sr-only"
              />
              {scope}
            </label>
          ))}
        </div>
      </div>

      {error && (
        <p className="text-sm text-red-600">{error}</p>
      )}

      <div className="flex gap-2">
        <button
          type="submit"
          disabled={submitting || !name.trim()}
          className="rounded bg-indigo-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
        >
          {submitting ? 'Creating…' : 'Create Key'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded border border-gray-300 px-4 py-1.5 text-sm text-gray-700 hover:bg-gray-50"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

// ─── New Key Display ────────────────────────────────────────

function NewKeyDisplay({
  response,
  onDismiss,
}: {
  response: ApiKeyCreated;
  onDismiss: () => void;
}): React.ReactElement {
  const [copied, setCopied] = useState(false);

  const copyKey = async () => {
    await navigator.clipboard.writeText(response.key);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="rounded-lg border border-amber-300 bg-amber-50 p-4">
      <div className="flex items-start gap-2">
        <span className="text-lg">⚠️</span>
        <div className="flex-1">
          <h3 className="font-semibold text-amber-900">Save your API key</h3>
          <p className="mt-1 text-sm text-amber-800">
            This is the only time you will see this key. Copy it now and store it securely.
          </p>
          <div className="mt-3 flex items-center gap-2">
            <code className="flex-1 rounded bg-white px-3 py-2 font-mono text-sm text-gray-900 shadow-inner">
              {response.key}
            </code>
            <button
              type="button"
              onClick={copyKey}
              className="rounded border border-gray-300 px-3 py-2 text-sm hover:bg-gray-50"
            >
              {copied ? '✓ Copied' : 'Copy'}
            </button>
          </div>
          <div className="mt-2 flex items-center gap-2 text-xs text-gray-600">
            <span>Name: {response.name}</span>
            <span>·</span>
            <span>Scopes: {response.scopes.join(', ')}</span>
          </div>
          <button
            type="button"
            onClick={onDismiss}
            className="mt-3 text-sm text-amber-700 underline hover:text-amber-900"
          >
            I&apos;ve saved the key
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Revoke Confirmation Dialog ─────────────────────────────

function RevokeDialog({
  keyInfo,
  onConfirm,
  onCancel,
}: {
  keyInfo: ApiKeyInfo;
  onConfirm: () => Promise<void>;
  onCancel: () => void;
}): React.ReactElement {
  const [revoking, setRevoking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleRevoke = async () => {
    setRevoking(true);
    setError(null);
    try {
      await onConfirm();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setRevoking(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="w-full max-w-md rounded-lg bg-white p-6 shadow-xl">
        <h3 className="text-lg font-semibold text-gray-900">Revoke API Key</h3>
        <p className="mt-2 text-sm text-gray-600">
          Are you sure you want to revoke <strong>{keyInfo.name}</strong>? This action cannot be
          undone. Any agents using this key will lose access immediately.
        </p>
        {error && (
          <p className="mt-2 text-sm text-red-600">
            Failed to revoke key: {error}
          </p>
        )}
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={revoking}
            className="rounded border border-gray-300 px-4 py-1.5 text-sm text-gray-700 hover:bg-gray-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleRevoke}
            disabled={revoking}
            className="rounded bg-red-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
          >
            {revoking ? 'Revoking…' : 'Revoke Key'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── API Keys Tab ───────────────────────────────────────────

function ApiKeysTab(): React.ReactElement {
  const { data: keys, loading, error, refetch } = useApi(() => getKeys(), []);
  const [showCreate, setShowCreate] = useState(false);
  const [newKey, setNewKey] = useState<ApiKeyCreated | null>(null);
  const [revokeTarget, setRevokeTarget] = useState<ApiKeyInfo | null>(null);

  const handleCreated = (resp: ApiKeyCreated) => {
    setNewKey(resp);
    setShowCreate(false);
    refetch();
  };

  const handleRevoke = async () => {
    if (!revokeTarget) return;
    await revokeKey(revokeTarget.id);
    setRevokeTarget(null);
    refetch();
  };

  const activeKeys = (keys ?? []).filter((k) => !k.revokedAt);
  const revokedKeys = (keys ?? []).filter((k) => k.revokedAt);

  return (
    <div className="space-y-4">
      {newKey && <NewKeyDisplay response={newKey} onDismiss={() => setNewKey(null)} />}

      {showCreate ? (
        <CreateKeyForm onCreated={handleCreated} onCancel={() => setShowCreate(false)} />
      ) : (
        <button
          type="button"
          onClick={() => setShowCreate(true)}
          className="rounded bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
        >
          + Create API Key
        </button>
      )}

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {loading && !keys && (
        <p className="py-8 text-center text-sm text-gray-500">Loading API keys…</p>
      )}

      {activeKeys.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-gray-200">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                  Name
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                  Scopes
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                  Created
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                  Last Used
                </th>
                <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-gray-500">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 bg-white">
              {activeKeys.map((key) => (
                <tr key={key.id}>
                  <td className="whitespace-nowrap px-4 py-3 text-sm font-medium text-gray-900">
                    {key.name}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-1">
                      {key.scopes.map((s) => (
                        <span
                          key={s}
                          className="rounded bg-gray-100 px-2 py-0.5 text-xs text-gray-600"
                        >
                          {s}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-500">
                    {new Date(key.createdAt).toLocaleDateString()}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-500">
                    {key.lastUsedAt ? new Date(key.lastUsedAt).toLocaleDateString() : 'Never'}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-right">
                    <button
                      type="button"
                      onClick={() => setRevokeTarget(key)}
                      className="text-sm text-red-600 hover:text-red-800"
                    >
                      Revoke
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {keys && activeKeys.length === 0 && !showCreate && !newKey && (
        <div className="rounded-lg border border-gray-200 bg-white py-8 text-center">
          <p className="text-gray-500">No API keys</p>
          <p className="mt-1 text-sm text-gray-400">
            Create an API key to authenticate agents
          </p>
        </div>
      )}

      {revokedKeys.length > 0 && (
        <details className="rounded-lg border border-gray-200">
          <summary className="cursor-pointer px-4 py-3 text-sm font-medium text-gray-600 hover:bg-gray-50">
            Revoked Keys ({revokedKeys.length})
          </summary>
          <div className="divide-y divide-gray-100">
            {revokedKeys.map((key) => (
              <div
                key={key.id}
                className="flex items-center justify-between px-4 py-2 text-sm text-gray-400"
              >
                <span className="line-through">{key.name}</span>
                <span>
                  Revoked {key.revokedAt ? new Date(key.revokedAt).toLocaleDateString() : ''}
                </span>
              </div>
            ))}
          </div>
        </details>
      )}

      {revokeTarget && (
        <RevokeDialog
          keyInfo={revokeTarget}
          onConfirm={handleRevoke}
          onCancel={() => setRevokeTarget(null)}
        />
      )}
    </div>
  );
}

// ─── Configuration Tab (Story 8.4) ─────────────────────────

interface ConfigFormState {
  retentionDays: string;
  agentGateUrl: string;
  agentGateSecret: string;
  formBridgeUrl: string;
  formBridgeSecret: string;
}

function ConfigurationTab(): React.ReactElement {
  const { data: stats, loading: statsLoading, error: statsError } = useApi(() => getStats(), []);
  const { data: configData, loading: configLoading, error: configError, refetch: refetchConfig } = useApi(() => getConfig(), []);

  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [form, setForm] = useState<ConfigFormState>({
    retentionDays: '90',
    agentGateUrl: '',
    agentGateSecret: '',
    formBridgeUrl: '',
    formBridgeSecret: '',
  });

  // Sync form state when config loads
  React.useEffect(() => {
    if (configData) {
      setForm({
        retentionDays: String(configData.retentionDays ?? 90),
        agentGateUrl: configData.agentGateUrl ?? '',
        agentGateSecret: '', // Don't pre-fill masked secrets
        formBridgeUrl: configData.formBridgeUrl ?? '',
        formBridgeSecret: '', // Don't pre-fill masked secrets
      });
    }
  }, [configData]);

  const handleEdit = () => {
    setEditing(true);
    setSaveSuccess(false);
    setSaveError(null);
  };

  const handleCancel = () => {
    setEditing(false);
    setSaveError(null);
    // Reset form to server values
    if (configData) {
      setForm({
        retentionDays: String(configData.retentionDays ?? 90),
        agentGateUrl: configData.agentGateUrl ?? '',
        agentGateSecret: '',
        formBridgeUrl: configData.formBridgeUrl ?? '',
        formBridgeSecret: '',
      });
    }
  };

  const handleSave = async () => {
    setSaving(true);
    setSaveError(null);
    setSaveSuccess(false);
    try {
      const payload: Partial<ConfigData> = {
        retentionDays: parseInt(form.retentionDays, 10) || 90,
        agentGateUrl: form.agentGateUrl,
        formBridgeUrl: form.formBridgeUrl,
      };
      // Only send secrets if the user actually typed something
      if (form.agentGateSecret) {
        payload.agentGateSecret = form.agentGateSecret;
      }
      if (form.formBridgeSecret) {
        payload.formBridgeSecret = form.formBridgeSecret;
      }
      await updateConfig(payload);
      setSaveSuccess(true);
      setEditing(false);
      refetchConfig();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const updateField = (field: keyof ConfigFormState, value: string) => {
    setForm((f) => ({ ...f, [field]: value }));
  };

  return (
    <div className="space-y-6">
      {/* Storage Stats */}
      <div>
        <h3 className="text-lg font-semibold text-gray-900">Storage Statistics</h3>
        {statsError && (
          <div className="mt-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            {statsError}
          </div>
        )}
        {statsLoading && !stats && (
          <p className="mt-2 text-sm text-gray-500">Loading…</p>
        )}
        {stats && (
          <div className="mt-3 grid gap-4 sm:grid-cols-3">
            <StatsCard label="Total Events" value={formatNumber(stats.totalEvents)} />
            <StatsCard label="Total Sessions" value={formatNumber(stats.totalSessions)} />
            <StatsCard label="Total Agents" value={formatNumber(stats.totalAgents)} />
          </div>
        )}
      </div>

      {/* Configuration */}
      <div>
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold text-gray-900">Configuration</h3>
          {!editing && (
            <button
              type="button"
              onClick={handleEdit}
              className="rounded border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50"
            >
              Edit
            </button>
          )}
        </div>

        {configError && (
          <div className="mt-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            {configError}
          </div>
        )}
        {configLoading && !configData && (
          <p className="mt-2 text-sm text-gray-500">Loading configuration…</p>
        )}

        {saveSuccess && (
          <div className="mt-2 rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-green-700">
            Configuration saved successfully.
          </div>
        )}
        {saveError && (
          <div className="mt-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            Failed to save: {saveError}
          </div>
        )}

        <div className="mt-4 overflow-hidden rounded-lg border border-gray-200">
          {/* Retention Period */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-gray-900">Retention Period</p>
              <p className="text-xs text-gray-500">Events older than this are automatically deleted</p>
            </div>
            {editing ? (
              <div className="flex items-center gap-1 ml-4">
                <input
                  type="number"
                  min={0}
                  max={3650}
                  value={form.retentionDays}
                  onChange={(e) => updateField('retentionDays', e.target.value)}
                  className="w-20 rounded border border-gray-300 px-2 py-1 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                />
                <span className="text-sm text-gray-500">days</span>
              </div>
            ) : (
              <span className="rounded bg-gray-50 px-3 py-1 font-mono text-sm text-gray-700 ml-4">
                {configData?.retentionDays ?? 90} days
              </span>
            )}
          </div>

          {/* AgentGate URL */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-gray-900">AgentGate URL</p>
              <p className="text-xs text-gray-500">Webhook URL for AgentGate approval events</p>
            </div>
            {editing ? (
              <input
                type="url"
                value={form.agentGateUrl}
                onChange={(e) => updateField('agentGateUrl', e.target.value)}
                placeholder="https://..."
                className="ml-4 w-64 rounded border border-gray-300 px-2 py-1 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              />
            ) : (
              <span className="rounded bg-gray-50 px-3 py-1 font-mono text-sm text-gray-700 ml-4">
                {configData?.agentGateUrl || 'Not configured'}
              </span>
            )}
          </div>

          {/* AgentGate Secret */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-gray-900">AgentGate Secret</p>
              <p className="text-xs text-gray-500">Shared secret for AgentGate webhook verification</p>
            </div>
            {editing ? (
              <input
                type="password"
                value={form.agentGateSecret}
                onChange={(e) => updateField('agentGateSecret', e.target.value)}
                placeholder="Leave blank to keep current"
                className="ml-4 w-64 rounded border border-gray-300 px-2 py-1 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              />
            ) : (
              <span className="rounded bg-gray-50 px-3 py-1 font-mono text-sm text-gray-700 ml-4">
                {configData?.agentGateSecret || 'Not set'}
              </span>
            )}
          </div>

          {/* FormBridge URL */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-gray-900">FormBridge URL</p>
              <p className="text-xs text-gray-500">Webhook URL for FormBridge form events</p>
            </div>
            {editing ? (
              <input
                type="url"
                value={form.formBridgeUrl}
                onChange={(e) => updateField('formBridgeUrl', e.target.value)}
                placeholder="https://..."
                className="ml-4 w-64 rounded border border-gray-300 px-2 py-1 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              />
            ) : (
              <span className="rounded bg-gray-50 px-3 py-1 font-mono text-sm text-gray-700 ml-4">
                {configData?.formBridgeUrl || 'Not configured'}
              </span>
            )}
          </div>

          {/* FormBridge Secret */}
          <div className="flex items-center justify-between px-4 py-3">
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-gray-900">FormBridge Secret</p>
              <p className="text-xs text-gray-500">Shared secret for FormBridge webhook verification</p>
            </div>
            {editing ? (
              <input
                type="password"
                value={form.formBridgeSecret}
                onChange={(e) => updateField('formBridgeSecret', e.target.value)}
                placeholder="Leave blank to keep current"
                className="ml-4 w-64 rounded border border-gray-300 px-2 py-1 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              />
            ) : (
              <span className="rounded bg-gray-50 px-3 py-1 font-mono text-sm text-gray-700 ml-4">
                {configData?.formBridgeSecret || 'Not set'}
              </span>
            )}
          </div>
        </div>

        {/* Save/Cancel buttons */}
        {editing && (
          <div className="mt-4 flex gap-2">
            <button
              type="button"
              onClick={handleSave}
              disabled={saving}
              className="rounded bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
            >
              {saving ? 'Saving…' : 'Save Configuration'}
            </button>
            <button
              type="button"
              onClick={handleCancel}
              disabled={saving}
              className="rounded border border-gray-300 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
            >
              Cancel
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function StatsCard({ label, value }: { label: string; value: string }): React.ReactElement {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <p className="text-xs font-medium uppercase text-gray-500">{label}</p>
      <p className="mt-1 text-2xl font-bold text-gray-900">{value}</p>
    </div>
  );
}

function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString();
}

// ─── Integrations Tab (Story 9.5) ───────────────────────────

function IntegrationsTab(): React.ReactElement {
  const { data: configData, loading, error, refetch } = useApi(() => getConfig(), []);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [secretForm, setSecretForm] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);

  // Infer the webhook receiver URL from the current page origin
  const webhookUrl = `${window.location.origin}/api/events/ingest`;

  const handleTestWebhook = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const testPayload = {
        source: 'agentgate' as const,
        event: 'request.created',
        data: {
          requestId: `test_${Date.now()}`,
          action: 'agentlens_webhook_test',
          params: { test: true },
          urgency: 'low',
        },
        timestamp: new Date().toISOString(),
      };

      const res = await fetch('/api/events/ingest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(testPayload),
      });

      if (res.ok) {
        const json = await res.json();
        setTestResult({
          ok: true,
          message: `✅ Webhook received successfully! Event ID: ${json.eventId}`,
        });
      } else {
        const json = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
        setTestResult({
          ok: false,
          message: `❌ Webhook failed: ${json.error || `HTTP ${res.status}`}`,
        });
      }
    } catch (err) {
      setTestResult({
        ok: false,
        message: `❌ Connection failed: ${err instanceof Error ? err.message : String(err)}`,
      });
    } finally {
      setTesting(false);
    }
  };

  const handleSaveSecret = async () => {
    if (!secretForm.trim()) return;
    setSaving(true);
    setSaveSuccess(false);
    try {
      await updateConfig({ agentGateSecret: secretForm.trim() });
      setSaveSuccess(true);
      setSecretForm('');
      refetch();
    } catch {
      // Error handling is already shown via the config state
    } finally {
      setSaving(false);
    }
  };

  const [copied, setCopied] = useState(false);
  const handleCopyUrl = async () => {
    await navigator.clipboard.writeText(webhookUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="space-y-6">
      {/* AgentGate Integration */}
      <div>
        <h3 className="text-lg font-semibold text-gray-900">AgentGate Integration</h3>
        <p className="mt-1 text-sm text-gray-500">
          Receive approval events from AgentGate to see human-in-the-loop decisions in your agent timelines.
        </p>

        {error && (
          <div className="mt-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            {error}
          </div>
        )}

        <div className="mt-4 overflow-hidden rounded-lg border border-gray-200">
          {/* Webhook URL (read-only) */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-gray-900">Webhook URL</p>
              <p className="text-xs text-gray-500">Configure this URL in AgentGate&apos;s webhook settings</p>
            </div>
            <div className="flex items-center gap-2 ml-4">
              <code className="rounded bg-gray-50 px-3 py-1.5 font-mono text-xs text-gray-700 max-w-md truncate">
                {webhookUrl}
              </code>
              <button
                type="button"
                onClick={handleCopyUrl}
                className="rounded border border-gray-300 px-2 py-1.5 text-xs hover:bg-gray-50"
              >
                {copied ? '✓' : '📋'}
              </button>
            </div>
          </div>

          {/* Webhook Secret */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-gray-900">Webhook Secret</p>
              <p className="text-xs text-gray-500">HMAC-SHA256 shared secret for signature verification</p>
            </div>
            <div className="flex items-center gap-2 ml-4">
              {loading ? (
                <span className="text-sm text-gray-400">Loading…</span>
              ) : (
                <span className="rounded bg-gray-50 px-3 py-1 font-mono text-sm text-gray-700">
                  {configData?.agentGateSecret || 'Not set'}
                </span>
              )}
            </div>
          </div>

          {/* Update Secret */}
          <div className="px-4 py-3 border-b border-gray-100">
            <div className="flex items-center gap-2">
              <input
                type="password"
                value={secretForm}
                onChange={(e) => setSecretForm(e.target.value)}
                placeholder="Enter new webhook secret"
                className="flex-1 rounded border border-gray-300 px-3 py-1.5 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              />
              <button
                type="button"
                onClick={handleSaveSecret}
                disabled={saving || !secretForm.trim()}
                className="rounded bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
              >
                {saving ? 'Saving…' : 'Update Secret'}
              </button>
            </div>
            {saveSuccess && (
              <p className="mt-1 text-xs text-green-600">✓ Secret updated successfully</p>
            )}
          </div>

          {/* Test Webhook */}
          <div className="px-4 py-3">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-900">Test Webhook</p>
                <p className="text-xs text-gray-500">Send a test approval event to verify the connection</p>
              </div>
              <button
                type="button"
                onClick={handleTestWebhook}
                disabled={testing}
                className="rounded border border-indigo-300 bg-indigo-50 px-3 py-1.5 text-sm font-medium text-indigo-700 hover:bg-indigo-100 disabled:opacity-50"
              >
                {testing ? 'Testing…' : '🧪 Send Test Event'}
              </button>
            </div>
            {testResult && (
              <div
                className={`mt-2 rounded-lg border p-2 text-sm ${
                  testResult.ok
                    ? 'border-green-200 bg-green-50 text-green-700'
                    : 'border-red-200 bg-red-50 text-red-700'
                }`}
              >
                {testResult.message}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Setup Instructions */}
      <div className="rounded-lg border border-blue-200 bg-blue-50 p-4">
        <h4 className="font-medium text-blue-900">Setup Instructions</h4>
        <ol className="mt-2 space-y-1 text-sm text-blue-800 list-decimal list-inside">
          <li>Copy the webhook URL above</li>
          <li>In AgentGate, go to Settings → Webhooks</li>
          <li>Add a new webhook with the URL and a shared secret</li>
          <li>Select events: <code className="bg-blue-100 px-1 rounded text-xs">request.created</code>, <code className="bg-blue-100 px-1 rounded text-xs">request.approved</code>, <code className="bg-blue-100 px-1 rounded text-xs">request.denied</code>, <code className="bg-blue-100 px-1 rounded text-xs">request.expired</code></li>
          <li>Set the same secret in the field above</li>
          <li>Click &quot;Send Test Event&quot; to verify</li>
        </ol>
      </div>
    </div>
  );
}

// ─── Main Settings Component ────────────────────────────────

export default function Settings(): React.ReactElement {
  const [activeTab, setActiveTab] = useState<SettingsTab>('keys');

  const tabs: Array<{ id: SettingsTab; label: string }> = [
    { id: 'keys', label: 'API Keys' },
    { id: 'config', label: 'Configuration' },
    { id: 'integrations', label: 'Integrations' },
  ];

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-gray-900">Settings</h1>

      {/* Tab Switcher */}
      <div className="border-b border-gray-200">
        <nav className="-mb-px flex gap-6">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`border-b-2 pb-3 text-sm font-medium transition ${
                activeTab === tab.id
                  ? 'border-indigo-500 text-indigo-600'
                  : 'border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </nav>
      </div>

      {/* Tab Content */}
      {activeTab === 'keys' && <ApiKeysTab />}
      {activeTab === 'config' && <ConfigurationTab />}
      {activeTab === 'integrations' && <IntegrationsTab />}
    </div>
  );
}
