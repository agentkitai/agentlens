/**
 * Integrations tab — extracted from Settings.tsx (cq-002)
 */

import React, { useState } from 'react';
import {
  getConfig,
  updateConfig,
} from '../../api/client';
import { useApi } from '../../hooks/useApi';

export function IntegrationsTab(): React.ReactElement {
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
