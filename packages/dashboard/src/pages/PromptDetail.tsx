/**
 * Prompt Detail Page (Story 19.10)
 *
 * Route: /prompts/:id
 *
 * Features:
 *  - Version history timeline
 *  - Content viewer
 *  - Side-by-side diff between versions
 *  - Per-version analytics charts
 */
import React, { useState, useMemo } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from 'recharts';
import { useApi } from '../hooks/useApi';
import {
  getPrompt,
  getPromptAnalytics,
  getPromptDiff,
  createPromptVersion,
  deletePrompt,
} from '../api/prompts';
import type {
  PromptTemplate,
  PromptVersion,
  PromptVersionAnalytics,
  PromptDiffResponse,
} from '../api/prompts';

// ─── Helpers ────────────────────────────────────────────────────

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

function formatCost(usd: number): string {
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  if (usd < 1) return `$${usd.toFixed(3)}`;
  return `$${usd.toFixed(2)}`;
}

// ─── Diff Viewer ────────────────────────────────────────────────

function DiffViewer({ diff }: { diff: string }) {
  const lines = diff.split('\n');
  return (
    <pre className="text-xs font-mono overflow-x-auto bg-gray-50 rounded-lg p-4 max-h-96 overflow-y-auto">
      {lines.map((line, i) => {
        let cls = 'text-gray-700';
        if (line.startsWith('+') && !line.startsWith('+++')) cls = 'text-green-700 bg-green-50';
        else if (line.startsWith('-') && !line.startsWith('---')) cls = 'text-red-700 bg-red-50';
        else if (line.startsWith('@@')) cls = 'text-blue-600';
        return (
          <div key={i} className={cls}>
            {line}
          </div>
        );
      })}
    </pre>
  );
}

// ─── New Version Modal ──────────────────────────────────────────

function NewVersionModal({
  templateId,
  currentContent,
  onClose,
  onCreated,
}: {
  templateId: string;
  currentContent: string;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [content, setContent] = useState(currentContent);
  const [changelog, setChangelog] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!content.trim()) return;
    setSaving(true);
    setError('');
    try {
      await createPromptVersion(templateId, { content, changelog });
      onCreated();
      onClose();
    } catch (err: any) {
      setError(err?.message || 'Failed to create version');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl mx-4 p-6" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-lg font-bold text-gray-900 mb-4">Create New Version</h2>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Content *</label>
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              rows={12}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm font-mono focus:ring-2 focus:ring-brand-500"
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Changelog</label>
            <input
              type="text"
              value={changelog}
              onChange={(e) => setChangelog(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
              placeholder="What changed?"
            />
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <div className="flex justify-end gap-3">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 rounded-lg">
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving || !content.trim()}
              className="px-4 py-2 text-sm font-medium text-white bg-brand-600 hover:bg-brand-700 rounded-lg disabled:opacity-50"
            >
              {saving ? 'Creating…' : 'Create Version'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Component ──────────────────────────────────────────────────

export function PromptDetail(): React.ReactElement {
  const { id } = useParams<{ id: string }>();
  const [selectedVersion, setSelectedVersion] = useState<PromptVersion | null>(null);
  const [diffV1, setDiffV1] = useState<string>('');
  const [diffV2, setDiffV2] = useState<string>('');
  const [diffData, setDiffData] = useState<PromptDiffResponse | null>(null);
  const [diffLoading, setDiffLoading] = useState(false);
  const [showNewVersion, setShowNewVersion] = useState(false);

  // Fetch template + versions
  const { data, loading, error, refetch } = useApi<{
    template: PromptTemplate;
    versions: PromptVersion[];
  }>(() => getPrompt(id!), [id]);

  // Fetch analytics
  const { data: analytics } = useApi<PromptVersionAnalytics[]>(
    () => getPromptAnalytics(id!),
    [id],
  );

  const template = data?.template;
  const versions = data?.versions ?? [];

  // Auto-select current version
  const displayVersion = selectedVersion ?? versions[0] ?? null;

  // Load diff
  const handleDiff = async () => {
    if (!diffV1 || !diffV2 || diffV1 === diffV2) return;
    setDiffLoading(true);
    try {
      const result = await getPromptDiff(id!, diffV1, diffV2);
      setDiffData(result);
    } catch {
      setDiffData(null);
    } finally {
      setDiffLoading(false);
    }
  };

  // Analytics chart data
  const chartData = useMemo(() => {
    if (!analytics) return [];
    return analytics.map((a) => ({
      version: `v${a.versionNumber}`,
      calls: a.callCount,
      cost: a.totalCostUsd,
      latency: a.avgLatencyMs,
      errorRate: a.errorRate,
    }));
  }, [analytics]);

  // ── 404 ─────────────────────────────────────────────────────────

  if (error?.includes('404')) {
    return (
      <div className="text-center py-16">
        <span className="text-6xl">📝</span>
        <h1 className="text-2xl font-bold text-gray-900 mb-2 mt-4">Prompt Not Found</h1>
        <Link to="/prompts" className="text-blue-600 hover:text-blue-800 font-medium">
          ← Back to Prompts
        </Link>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex justify-center py-16">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-4 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
        Error loading prompt: {error}
      </div>
    );
  }

  if (!template) return <></>;

  return (
    <div className="space-y-6">
      {/* Back + header */}
      <Link to="/prompts" className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700">
        ← Prompts
      </Link>

      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{template.name}</h1>
          {template.description && (
            <p className="text-sm text-gray-500 mt-1">{template.description}</p>
          )}
          <div className="flex items-center gap-3 mt-2 text-xs text-gray-500">
            <span className="inline-flex px-2 py-0.5 rounded-full bg-gray-100 text-gray-600 font-medium">
              {template.category}
            </span>
            <span>Current: v{template.currentVersionNumber}</span>
            <span>Updated: {formatDate(template.updatedAt)}</span>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setShowNewVersion(true)}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-brand-600 text-white text-sm font-medium hover:bg-brand-700"
        >
          New Version
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Version list */}
        <div className="lg:col-span-1">
          <div className="rounded-xl border border-gray-200 bg-white shadow-sm">
            <h3 className="text-sm font-semibold text-gray-900 px-4 py-3 border-b border-gray-200">
              Versions ({versions.length})
            </h3>
            <div className="max-h-96 overflow-y-auto divide-y divide-gray-100">
              {versions.map((v) => (
                <button
                  key={v.id}
                  type="button"
                  onClick={() => setSelectedVersion(v)}
                  className={`w-full text-left px-4 py-3 hover:bg-gray-50 transition-colors ${
                    displayVersion?.id === v.id ? 'bg-blue-50' : ''
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-gray-900">v{v.versionNumber}</span>
                    <span className="text-xs text-gray-400">{formatDate(v.createdAt)}</span>
                  </div>
                  {v.changelog && (
                    <p className="text-xs text-gray-500 mt-0.5 truncate">{v.changelog}</p>
                  )}
                  {v.createdBy && (
                    <p className="text-xs text-gray-400 mt-0.5">by {v.createdBy}</p>
                  )}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Content viewer */}
        <div className="lg:col-span-2 space-y-6">
          {displayVersion && (
            <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
              <h3 className="text-sm font-semibold text-gray-900 mb-2">
                Version {displayVersion.versionNumber} Content
              </h3>
              <pre className="text-sm font-mono bg-gray-50 rounded-lg p-4 overflow-x-auto max-h-96 overflow-y-auto whitespace-pre-wrap">
                {displayVersion.content}
              </pre>
              {displayVersion.variables && displayVersion.variables.length > 0 && (
                <div className="mt-4">
                  <h4 className="text-xs font-semibold text-gray-500 uppercase mb-2">Variables</h4>
                  <div className="flex flex-wrap gap-2">
                    {displayVersion.variables.map((v) => (
                      <span key={v.name} className="inline-flex items-center px-2 py-1 rounded bg-blue-50 text-blue-700 text-xs font-mono">
                        {'{{' + v.name + '}}'}
                        {v.required && <span className="ml-1 text-red-400">*</span>}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Diff viewer */}
          {versions.length >= 2 && (
            <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
              <h3 className="text-sm font-semibold text-gray-900 mb-3">Version Diff</h3>
              <div className="flex items-center gap-3 mb-4">
                <select
                  value={diffV1}
                  onChange={(e) => setDiffV1(e.target.value)}
                  className="rounded border border-gray-300 bg-white px-3 py-1.5 text-sm"
                >
                  <option value="">Select v1</option>
                  {versions.map((v) => (
                    <option key={v.id} value={v.id}>v{v.versionNumber}</option>
                  ))}
                </select>
                <span className="text-gray-400">→</span>
                <select
                  value={diffV2}
                  onChange={(e) => setDiffV2(e.target.value)}
                  className="rounded border border-gray-300 bg-white px-3 py-1.5 text-sm"
                >
                  <option value="">Select v2</option>
                  {versions.map((v) => (
                    <option key={v.id} value={v.id}>v{v.versionNumber}</option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={handleDiff}
                  disabled={!diffV1 || !diffV2 || diffV1 === diffV2 || diffLoading}
                  className="px-4 py-1.5 text-sm font-medium text-white bg-brand-600 hover:bg-brand-700 rounded-lg disabled:opacity-50"
                >
                  {diffLoading ? 'Loading…' : 'Compare'}
                </button>
              </div>
              {diffData && <DiffViewer diff={diffData.diff} />}
            </div>
          )}

          {/* Analytics */}
          {chartData.length > 0 && (
            <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
              <h3 className="text-sm font-semibold text-gray-900 mb-4">Version Analytics</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Calls per version */}
                <div>
                  <h4 className="text-xs text-gray-500 font-medium mb-2">Calls per Version</h4>
                  <ResponsiveContainer width="100%" height={200}>
                    <BarChart data={chartData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                      <XAxis dataKey="version" tick={{ fontSize: 11 }} />
                      <YAxis tick={{ fontSize: 11 }} />
                      <Tooltip />
                      <Bar dataKey="calls" fill="#6366f1" radius={[4, 4, 0, 0]} name="Calls" />
                    </BarChart>
                  </ResponsiveContainer>
                </div>

                {/* Cost per version */}
                <div>
                  <h4 className="text-xs text-gray-500 font-medium mb-2">Cost per Version</h4>
                  <ResponsiveContainer width="100%" height={200}>
                    <BarChart data={chartData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                      <XAxis dataKey="version" tick={{ fontSize: 11 }} />
                      <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `$${v}`} />
                      <Tooltip formatter={(v: number) => [formatCost(v), 'Cost']} />
                      <Bar dataKey="cost" fill="#f59e0b" radius={[4, 4, 0, 0]} name="Cost" />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>

              {/* Analytics table */}
              {analytics && analytics.length > 0 && (
                <div className="mt-4 overflow-x-auto">
                  <table className="min-w-full divide-y divide-gray-200 text-sm">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-3 py-2 text-left text-xs font-semibold text-gray-500">Version</th>
                        <th className="px-3 py-2 text-right text-xs font-semibold text-gray-500">Calls</th>
                        <th className="px-3 py-2 text-right text-xs font-semibold text-gray-500">Total Cost</th>
                        <th className="px-3 py-2 text-right text-xs font-semibold text-gray-500">Avg Latency</th>
                        <th className="px-3 py-2 text-right text-xs font-semibold text-gray-500">Error Rate</th>
                        <th className="px-3 py-2 text-right text-xs font-semibold text-gray-500">Avg Tokens</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200">
                      {analytics.map((a) => (
                        <tr key={a.versionId} className="hover:bg-gray-50">
                          <td className="px-3 py-2 font-medium">v{a.versionNumber}</td>
                          <td className="px-3 py-2 text-right text-gray-600">{a.callCount}</td>
                          <td className="px-3 py-2 text-right font-mono">{formatCost(a.totalCostUsd)}</td>
                          <td className="px-3 py-2 text-right text-gray-600">{Math.round(a.avgLatencyMs)}ms</td>
                          <td className="px-3 py-2 text-right text-gray-600">{(a.errorRate * 100).toFixed(1)}%</td>
                          <td className="px-3 py-2 text-right text-gray-600">{Math.round(a.avgInputTokens + a.avgOutputTokens)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* New version modal */}
      {showNewVersion && (
        <NewVersionModal
          templateId={id!}
          currentContent={displayVersion?.content ?? ''}
          onClose={() => setShowNewVersion(false)}
          onCreated={() => refetch()}
        />
      )}
    </div>
  );
}
