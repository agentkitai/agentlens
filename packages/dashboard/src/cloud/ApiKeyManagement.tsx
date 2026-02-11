/**
 * API Key Management Page (S-7.3)
 *
 * Dashboard page for managing API keys:
 * - Create keys (show full key once with copy button)
 * - List keys with prefix, name, environment, last_used_at, created_at
 * - Revoke keys with confirmation dialog
 * - Tier limit indicator
 */

import { getErrorMessage } from '@agentlensai/core';
import React, { useState, useCallback, useEffect } from 'react';
import { useOrg } from './OrgContext';
import {
  listApiKeys,
  createApiKey,
  revokeApiKey,
  getApiKeyLimit,
  type CloudApiKey,
  type ApiKeyEnvironment,
  type ApiKeyLimitInfo,
} from './api';

const ENVIRONMENTS: ApiKeyEnvironment[] = ['production', 'staging', 'development', 'test'];

const ENV_LABELS: Record<ApiKeyEnvironment, string> = {
  production: '🟢 Production',
  staging: '🟡 Staging',
  development: '🔵 Development',
  test: '⚪ Test',
};

export function ApiKeyManagement(): React.ReactElement {
  const { currentOrg } = useOrg();
  const [keys, setKeys] = useState<CloudApiKey[]>([]);
  const [limitInfo, setLimitInfo] = useState<ApiKeyLimitInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Create form state
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newKeyName, setNewKeyName] = useState('');
  const [newKeyEnv, setNewKeyEnv] = useState<ApiKeyEnvironment>('production');
  const [creating, setCreating] = useState(false);

  // Newly created key (shown once)
  const [createdKey, setCreatedKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // Revoke confirmation
  const [revokeTarget, setRevokeTarget] = useState<CloudApiKey | null>(null);
  const [revoking, setRevoking] = useState(false);

  const orgId = currentOrg?.id;

  const refresh = useCallback(async () => {
    if (!orgId) return;
    setLoading(true);
    setError(null);
    try {
      const [keyList, limit] = await Promise.all([
        listApiKeys(orgId),
        getApiKeyLimit(orgId),
      ]);
      setKeys(keyList);
      setLimitInfo(limit);
    } catch (err: unknown) {
      setError(getErrorMessage(err) || 'Failed to load API keys');
    } finally {
      setLoading(false);
    }
  }, [orgId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const handleCreate = useCallback(async () => {
    if (!orgId || !newKeyName.trim()) return;
    setCreating(true);
    setError(null);
    try {
      const result = await createApiKey(orgId, newKeyName.trim(), newKeyEnv);
      setCreatedKey(result.fullKey);
      setCopied(false);
      setShowCreateForm(false);
      setNewKeyName('');
      setNewKeyEnv('production');
      await refresh();
    } catch (err: unknown) {
      setError(getErrorMessage(err) || 'Failed to create API key');
    } finally {
      setCreating(false);
    }
  }, [orgId, newKeyName, newKeyEnv, refresh]);

  const handleRevoke = useCallback(async () => {
    if (!orgId || !revokeTarget) return;
    setRevoking(true);
    try {
      await revokeApiKey(orgId, revokeTarget.id);
      setRevokeTarget(null);
      await refresh();
    } catch (err: unknown) {
      setError(getErrorMessage(err) || 'Failed to revoke API key');
    } finally {
      setRevoking(false);
    }
  }, [orgId, revokeTarget, refresh]);

  const handleCopy = useCallback(async () => {
    if (!createdKey) return;
    try {
      await navigator.clipboard.writeText(createdKey);
      setCopied(true);
    } catch {
      // Fallback: select text
    }
  }, [createdKey]);

  if (!currentOrg) {
    return <div className="p-6 text-gray-500">Select an organization to manage API keys.</div>;
  }

  const activeKeys = keys.filter((k) => !k.revoked_at);
  const revokedKeys = keys.filter((k) => k.revoked_at);
  const atLimit = limitInfo ? limitInfo.current >= limitInfo.limit : false;

  return (
    <div className="p-6 max-w-4xl" data-testid="api-key-management">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">API Keys</h1>
        {limitInfo && (
          <span className="text-sm text-gray-500" data-testid="key-limit-indicator">
            {limitInfo.current} / {limitInfo.limit} keys ({limitInfo.plan} plan)
          </span>
        )}
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded mb-4" role="alert">
          {error}
        </div>
      )}

      {/* Newly created key banner */}
      {createdKey && (
        <div className="bg-green-50 border border-green-200 px-4 py-3 rounded mb-4" data-testid="created-key-banner">
          <p className="text-sm text-green-800 font-medium mb-2">
            ✅ API key created! Copy it now — you won't see it again.
          </p>
          <div className="flex items-center gap-2">
            <code className="bg-white border px-3 py-1 rounded text-sm font-mono flex-1 truncate" data-testid="full-key-display">
              {createdKey}
            </code>
            <button
              onClick={handleCopy}
              className="px-3 py-1 bg-green-600 text-white text-sm rounded hover:bg-green-700"
              data-testid="copy-key-button"
            >
              {copied ? 'Copied!' : 'Copy'}
            </button>
            <button
              onClick={() => setCreatedKey(null)}
              className="px-3 py-1 bg-gray-200 text-gray-700 text-sm rounded hover:bg-gray-300"
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

      {/* Create button / form */}
      {!showCreateForm ? (
        <button
          onClick={() => setShowCreateForm(true)}
          disabled={atLimit}
          className="mb-6 px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
          data-testid="create-key-button"
        >
          {atLimit ? 'Key limit reached — upgrade plan' : 'Create API Key'}
        </button>
      ) : (
        <div className="mb-6 p-4 border rounded bg-gray-50" data-testid="create-key-form">
          <h3 className="text-lg font-medium mb-3">Create New API Key</h3>
          <div className="flex flex-col gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Name</label>
              <input
                type="text"
                value={newKeyName}
                onChange={(e) => setNewKeyName(e.target.value)}
                placeholder="e.g., Production Backend"
                className="w-full border rounded px-3 py-2 text-sm"
                data-testid="key-name-input"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Environment</label>
              <select
                value={newKeyEnv}
                onChange={(e) => setNewKeyEnv(e.target.value as ApiKeyEnvironment)}
                className="w-full border rounded px-3 py-2 text-sm"
                data-testid="key-env-select"
              >
                {ENVIRONMENTS.map((env) => (
                  <option key={env} value={env}>{ENV_LABELS[env]}</option>
                ))}
              </select>
            </div>
            <div className="flex gap-2">
              <button
                onClick={handleCreate}
                disabled={creating || !newKeyName.trim()}
                className="px-4 py-2 bg-blue-600 text-white text-sm rounded hover:bg-blue-700 disabled:opacity-50"
              >
                {creating ? 'Creating...' : 'Create'}
              </button>
              <button
                onClick={() => setShowCreateForm(false)}
                className="px-4 py-2 bg-gray-200 text-gray-700 text-sm rounded hover:bg-gray-300"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Active keys table */}
      {loading ? (
        <p className="text-gray-500">Loading...</p>
      ) : (
        <>
          <h2 className="text-lg font-semibold mb-3">Active Keys ({activeKeys.length})</h2>
          {activeKeys.length === 0 ? (
            <p className="text-gray-500 mb-6">No active API keys. Create one to get started.</p>
          ) : (
            <table className="w-full border-collapse mb-6" data-testid="active-keys-table">
              <thead>
                <tr className="border-b text-left text-sm text-gray-500">
                  <th className="pb-2">Prefix</th>
                  <th className="pb-2">Name</th>
                  <th className="pb-2">Environment</th>
                  <th className="pb-2">Last Used</th>
                  <th className="pb-2">Created</th>
                  <th className="pb-2"></th>
                </tr>
              </thead>
              <tbody>
                {activeKeys.map((key) => (
                  <tr key={key.id} className="border-b" data-testid={`key-row-${key.id}`}>
                    <td className="py-2 font-mono text-sm">{key.key_prefix}…</td>
                    <td className="py-2">{key.name}</td>
                    <td className="py-2 text-sm">{ENV_LABELS[key.environment]}</td>
                    <td className="py-2 text-sm text-gray-500">
                      {key.last_used_at ? new Date(key.last_used_at).toLocaleDateString() : 'Never'}
                    </td>
                    <td className="py-2 text-sm text-gray-500">
                      {new Date(key.created_at).toLocaleDateString()}
                    </td>
                    <td className="py-2">
                      <button
                        onClick={() => setRevokeTarget(key)}
                        className="text-red-600 text-sm hover:underline"
                        data-testid={`revoke-button-${key.id}`}
                      >
                        Revoke
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {/* Revoked keys (collapsed) */}
          {revokedKeys.length > 0 && (
            <details className="mb-6">
              <summary className="text-sm text-gray-500 cursor-pointer">
                Revoked Keys ({revokedKeys.length})
              </summary>
              <table className="w-full border-collapse mt-2 opacity-60" data-testid="revoked-keys-table">
                <thead>
                  <tr className="border-b text-left text-sm text-gray-400">
                    <th className="pb-2">Prefix</th>
                    <th className="pb-2">Name</th>
                    <th className="pb-2">Environment</th>
                    <th className="pb-2">Revoked</th>
                  </tr>
                </thead>
                <tbody>
                  {revokedKeys.map((key) => (
                    <tr key={key.id} className="border-b">
                      <td className="py-2 font-mono text-sm line-through">{key.key_prefix}…</td>
                      <td className="py-2 line-through">{key.name}</td>
                      <td className="py-2 text-sm">{ENV_LABELS[key.environment]}</td>
                      <td className="py-2 text-sm text-gray-400">
                        {key.revoked_at ? new Date(key.revoked_at).toLocaleDateString() : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </details>
          )}
        </>
      )}

      {/* Revoke confirmation dialog */}
      {revokeTarget && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" data-testid="revoke-dialog">
          <div className="bg-white rounded-lg p-6 max-w-md shadow-xl">
            <h3 className="text-lg font-bold mb-2">Revoke API Key?</h3>
            <p className="text-sm text-gray-600 mb-4">
              This will permanently revoke <strong>{revokeTarget.name}</strong> ({revokeTarget.key_prefix}…).
              Any services using this key will stop working immediately.
            </p>
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setRevokeTarget(null)}
                className="px-4 py-2 bg-gray-200 text-gray-700 text-sm rounded hover:bg-gray-300"
                data-testid="revoke-cancel"
              >
                Cancel
              </button>
              <button
                onClick={handleRevoke}
                disabled={revoking}
                className="px-4 py-2 bg-red-600 text-white text-sm rounded hover:bg-red-700 disabled:opacity-50"
                data-testid="revoke-confirm"
              >
                {revoking ? 'Revoking...' : 'Revoke Key'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default ApiKeyManagement;
