/**
 * Configuration tab — extracted from Settings.tsx (cq-002)
 */

import React, { useState } from 'react';
import type { StorageStats } from '@agentlensai/core';
import {
  getStats,
  getConfig,
  updateConfig,
  type ConfigData,
} from '../../api/client';
import { useApi } from '../../hooks/useApi';

// ─── Helpers ────────────────────────────────────────────────

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

// ─── Configuration Tab (Story 8.4) ─────────────────────────

interface ConfigFormState {
  retentionDays: string;
  agentGateUrl: string;
  agentGateSecret: string;
  formBridgeUrl: string;
  formBridgeSecret: string;
}

export function ConfigTab(): React.ReactElement {
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
        agentGateSecret: '',
        formBridgeUrl: configData.formBridgeUrl ?? '',
        formBridgeSecret: '',
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
