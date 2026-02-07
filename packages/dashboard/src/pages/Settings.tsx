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
import type { StorageStats } from '@agentlens/core';
import {
  getKeys,
  createKey,
  revokeKey,
  getStats,
  type ApiKeyInfo,
  type ApiKeyCreated,
} from '../api/client';
import { useApi } from '../hooks/useApi';

// ─── Tab type ───────────────────────────────────────────────

type SettingsTab = 'keys' | 'config';

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

  const handleRevoke = async () => {
    setRevoking(true);
    await onConfirm();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="w-full max-w-md rounded-lg bg-white p-6 shadow-xl">
        <h3 className="text-lg font-semibold text-gray-900">Revoke API Key</h3>
        <p className="mt-2 text-sm text-gray-600">
          Are you sure you want to revoke <strong>{keyInfo.name}</strong>? This action cannot be
          undone. Any agents using this key will lose access immediately.
        </p>
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
    try {
      await revokeKey(revokeTarget.id);
      setRevokeTarget(null);
      refetch();
    } catch {
      setRevokeTarget(null);
    }
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

interface ConfigItem {
  label: string;
  value: string | number;
  description: string;
}

function ConfigurationTab(): React.ReactElement {
  const { data: stats, loading, error } = useApi(() => getStats(), []);

  const configItems: ConfigItem[] = [
    {
      label: 'Retention Period',
      value: '90 days',
      description: 'Events older than this are automatically deleted',
    },
    {
      label: 'AgentGate URL',
      value: 'Not configured',
      description: 'Webhook URL for AgentGate approval events',
    },
    {
      label: 'AgentGate Secret',
      value: '••••••••',
      description: 'Shared secret for AgentGate webhook verification',
    },
    {
      label: 'FormBridge URL',
      value: 'Not configured',
      description: 'Webhook URL for FormBridge form events',
    },
    {
      label: 'FormBridge Secret',
      value: '••••••••',
      description: 'Shared secret for FormBridge webhook verification',
    },
  ];

  return (
    <div className="space-y-6">
      {/* Storage Stats */}
      <div>
        <h3 className="text-lg font-semibold text-gray-900">Storage Statistics</h3>
        {error && (
          <div className="mt-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            {error}
          </div>
        )}
        {loading && !stats && (
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

      {/* Configuration Display */}
      <div>
        <div className="flex items-center gap-2">
          <h3 className="text-lg font-semibold text-gray-900">Configuration</h3>
          <span className="rounded bg-gray-100 px-2 py-0.5 text-xs text-gray-500">
            Read-only
          </span>
        </div>
        <p className="mt-1 text-sm text-gray-500">
          Configuration changes require editing environment variables and restarting the server.
        </p>

        <div className="mt-4 overflow-hidden rounded-lg border border-gray-200">
          {configItems.map((item, i) => (
            <div
              key={item.label}
              className={`flex items-center justify-between px-4 py-3 ${
                i < configItems.length - 1 ? 'border-b border-gray-100' : ''
              }`}
            >
              <div>
                <p className="text-sm font-medium text-gray-900">{item.label}</p>
                <p className="text-xs text-gray-500">{item.description}</p>
              </div>
              <span className="rounded bg-gray-50 px-3 py-1 font-mono text-sm text-gray-700">
                {item.value}
              </span>
            </div>
          ))}
        </div>
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

// ─── Main Settings Component ────────────────────────────────

export default function Settings(): React.ReactElement {
  const [activeTab, setActiveTab] = useState<SettingsTab>('keys');

  const tabs: Array<{ id: SettingsTab; label: string }> = [
    { id: 'keys', label: 'API Keys' },
    { id: 'config', label: 'Configuration' },
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
    </div>
  );
}
