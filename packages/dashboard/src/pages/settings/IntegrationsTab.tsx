/**
 * Integrations tab — inbound webhooks from AgentKit products (AgentGate, FormBridge).
 * Each integration posts HMAC-signed events to /api/events/ingest; configure the
 * shared secret here (stored encrypted at rest, never returned).
 */

import React, { useState } from 'react';
import { getConfig, updateConfig } from '../../api/client';
import { useApi } from '../../hooks/useApi';

const WEBHOOK_URL = `${window.location.origin}/api/events/ingest`;

interface CardProps {
  title: string;
  description: string;
  /** Product name shown in the setup steps, e.g. "AgentGate". */
  provider: string;
  /** Whether a secret is already configured (secrets are write-only). */
  secretSet: boolean;
  loading: boolean;
  /** Webhook event names to subscribe to in the source product. */
  events: string[];
  onSaveSecret: (secret: string) => Promise<unknown>;
  onSaved: () => void;
}

function WebhookIntegrationCard({
  title, description, provider, secretSet, loading, events, onSaveSecret, onSaved,
}: CardProps): React.ReactElement {
  const [secretForm, setSecretForm] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [copied, setCopied] = useState(false);

  const handleSaveSecret = async () => {
    if (!secretForm.trim()) return;
    setSaving(true);
    setSaveSuccess(false);
    try {
      await onSaveSecret(secretForm.trim());
      setSaveSuccess(true);
      setSecretForm('');
      onSaved();
    } catch {
      // surfaced via the config error state
    } finally {
      setSaving(false);
    }
  };

  const handleCopyUrl = async () => {
    await navigator.clipboard.writeText(WEBHOOK_URL);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div>
      <h3 className="text-lg font-semibold text-gray-900">{title}</h3>
      <p className="mt-1 text-sm text-gray-500">{description}</p>

      <div className="mt-4 overflow-hidden rounded-lg border border-gray-200">
        {/* Webhook URL (read-only) */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-gray-900">Webhook URL</p>
            <p className="text-xs text-gray-500">Configure this URL in {provider}&apos;s webhook settings</p>
          </div>
          <div className="flex items-center gap-2 ml-4">
            <code className="rounded bg-gray-50 px-3 py-1.5 font-mono text-xs text-gray-700 max-w-md truncate">
              {WEBHOOK_URL}
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

        {/* Webhook Secret status */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-gray-900">Webhook Secret</p>
            <p className="text-xs text-gray-500">HMAC-SHA256 shared secret (encrypted at rest, never shown)</p>
          </div>
          <div className="flex items-center gap-2 ml-4">
            {loading ? (
              <span className="text-sm text-gray-400">Loading…</span>
            ) : secretSet ? (
              <span className="rounded bg-green-50 px-3 py-1 text-sm text-green-700">Configured ✓</span>
            ) : (
              <span className="rounded bg-gray-50 px-3 py-1 text-sm text-gray-500">Not set</span>
            )}
          </div>
        </div>

        {/* Update Secret */}
        <div className="px-4 py-3">
          <div className="flex items-center gap-2">
            <input
              type="password"
              value={secretForm}
              onChange={(e) => setSecretForm(e.target.value)}
              placeholder={secretSet ? 'Enter a new secret to replace' : 'Enter the shared secret'}
              className="flex-1 rounded border border-gray-300 px-3 py-1.5 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            />
            <button
              type="button"
              onClick={handleSaveSecret}
              disabled={saving || !secretForm.trim()}
              className="rounded bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
            >
              {saving ? 'Saving…' : 'Save Secret'}
            </button>
          </div>
          {saveSuccess && <p className="mt-1 text-xs text-green-600">✓ Secret saved</p>}
        </div>
      </div>

      {/* Setup steps */}
      <div className="mt-3 rounded-lg border border-blue-200 bg-blue-50 p-4">
        <ol className="space-y-1 text-sm text-blue-800 list-decimal list-inside">
          <li>Copy the webhook URL above</li>
          <li>In {provider}, add a webhook with that URL and a shared secret</li>
          <li>
            Subscribe to events:{' '}
            {events.map((e, i) => (
              <React.Fragment key={e}>
                {i > 0 && ', '}
                <code className="bg-blue-100 px-1 rounded text-xs">{e}</code>
              </React.Fragment>
            ))}
          </li>
          <li>Save the same secret in the field above</li>
        </ol>
      </div>
    </div>
  );
}

export function IntegrationsTab(): React.ReactElement {
  const { data: configData, loading, error, refetch } = useApi(() => getConfig(), []);

  return (
    <div className="space-y-8">
      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>
      )}

      <WebhookIntegrationCard
        title="AgentGate Integration"
        description="Receive approval events from AgentGate to see human-in-the-loop decisions in your agent timelines."
        provider="AgentGate"
        secretSet={!!configData?.agentGateSecretSet}
        loading={loading}
        events={['request.created', 'request.approved', 'request.denied', 'request.expired']}
        onSaveSecret={(secret) => updateConfig({ agentGateSecret: secret })}
        onSaved={refetch}
      />

      <WebhookIntegrationCard
        title="FormBridge Integration"
        description="Receive form submission events from FormBridge to see human-provided input in your agent timelines."
        provider="FormBridge"
        secretSet={!!configData?.formBridgeSecretSet}
        loading={loading}
        events={['submission.created', 'submission.completed', 'submission.expired']}
        onSaveSecret={(secret) => updateConfig({ formBridgeSecret: secret })}
        onSaved={refetch}
      />
    </div>
  );
}
