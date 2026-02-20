/**
 * Prompts List Page (Story 19.9)
 *
 * Route: /prompts
 *
 * Features:
 *  - Table of prompt templates with search and category filter
 *  - "Discovered Prompts" tab for auto-fingerprinted prompts
 *  - Create Template button
 *  - Row click → /prompts/:id
 */
import React, { useState, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApi } from '../hooks/useApi';
import {
  getPrompts,
  getPromptFingerprints,
  createPrompt,
  linkFingerprintToTemplate,
} from '../api/prompts';
import type { PromptTemplate, PromptFingerprint, PromptListResponse } from '../api/prompts';

// ─── Constants ──────────────────────────────────────────────────

const PAGE_SIZE = 20;
const CATEGORIES = ['general', 'system', 'assistant', 'tool', 'safety', 'other'];

type TabKey = 'templates' | 'discovered';

// ─── Helpers ────────────────────────────────────────────────────

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return iso;
  }
}

function categoryBadge(category: string): React.ReactElement {
  const colors: Record<string, string> = {
    system: 'bg-blue-100 text-blue-700',
    safety: 'bg-red-100 text-red-700',
    tool: 'bg-green-100 text-green-700',
    assistant: 'bg-purple-100 text-purple-700',
    general: 'bg-gray-100 text-gray-600',
  };
  const cls = colors[category] || 'bg-gray-100 text-gray-600';
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${cls}`}>
      {category}
    </span>
  );
}

// ─── Create Modal ───────────────────────────────────────────────

function CreatePromptModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: () => void;
}) {
  const [name, setName] = useState('');
  const [content, setContent] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('general');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !content.trim()) return;
    setSaving(true);
    setError('');
    try {
      await createPrompt({ name: name.trim(), content, description, category });
      onCreated();
      onClose();
    } catch (err: any) {
      setError(err?.message || 'Failed to create template');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div
        className="bg-white rounded-xl shadow-xl w-full max-w-lg mx-4 p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-bold text-gray-900 mb-4">Create Prompt Template</h2>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Name *</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:ring-2 focus:ring-brand-500 focus:border-brand-500"
              placeholder="My System Prompt"
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Category</label>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="rounded border border-gray-300 bg-white px-3 py-2 text-sm"
            >
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
              placeholder="Optional description"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Content *</label>
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              rows={8}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm font-mono focus:ring-2 focus:ring-brand-500 focus:border-brand-500"
              placeholder="You are a helpful assistant..."
              required
            />
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <div className="flex justify-end gap-3">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 rounded-lg"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving || !name.trim() || !content.trim()}
              className="px-4 py-2 text-sm font-medium text-white bg-brand-600 hover:bg-brand-700 rounded-lg disabled:opacity-50"
            >
              {saving ? 'Creating…' : 'Create'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Component ──────────────────────────────────────────────────

export function Prompts(): React.ReactElement {
  const navigate = useNavigate();
  const [tab, setTab] = useState<TabKey>('templates');
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [page, setPage] = useState(0);
  const [showCreate, setShowCreate] = useState(false);

  // Debounce search
  const searchTimerRef = React.useRef<ReturnType<typeof setTimeout>>(undefined);
  const handleSearch = useCallback((value: string) => {
    setSearch(value);
    clearTimeout(searchTimerRef.current);
    searchTimerRef.current = setTimeout(() => {
      setDebouncedSearch(value);
      setPage(0);
    }, 300);
  }, []);

  // Fetch templates
  const { data, loading, error, refetch } = useApi<PromptListResponse>(
    () =>
      getPrompts({
        search: debouncedSearch || undefined,
        category: categoryFilter || undefined,
        limit: PAGE_SIZE,
        offset: page * PAGE_SIZE,
      }),
    [debouncedSearch, categoryFilter, page],
  );

  // Fetch fingerprints (only when tab is 'discovered')
  const {
    data: fingerprints,
    loading: fpLoading,
    error: fpError,
  } = useApi<PromptFingerprint[]>(
    () => (tab === 'discovered' ? getPromptFingerprints() : Promise.resolve([])),
    [tab],
  );

  const templates = data?.templates ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Prompts</h1>
          <p className="mt-1 text-sm text-gray-500">
            Manage prompt templates and discover auto-detected prompts.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowCreate(true)}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-brand-600 text-white text-sm font-medium hover:bg-brand-700 transition-colors"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
          </svg>
          Create Template
        </button>
      </div>

      {/* Tabs */}
      <div className="border-b border-gray-200">
        <nav className="-mb-px flex gap-4" aria-label="Prompt tabs">
          {([
            { key: 'templates' as TabKey, label: 'Templates' },
            { key: 'discovered' as TabKey, label: 'Discovered Prompts' },
          ]).map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              className={`pb-3 px-1 text-sm font-medium border-b-2 transition-colors ${
                tab === t.key
                  ? 'border-brand-600 text-brand-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              {t.label}
            </button>
          ))}
        </nav>
      </div>

      {/* Templates tab */}
      {tab === 'templates' && (
        <>
          {/* Filters */}
          <div className="flex flex-wrap items-center gap-3">
            <input
              type="text"
              value={search}
              onChange={(e) => handleSearch(e.target.value)}
              placeholder="Search templates…"
              className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm w-64 focus:ring-2 focus:ring-brand-500 focus:border-brand-500"
            />
            <select
              value={categoryFilter}
              onChange={(e) => { setCategoryFilter(e.target.value); setPage(0); }}
              className="rounded border border-gray-300 bg-white px-3 py-1.5 text-sm"
            >
              <option value="">All Categories</option>
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
            {(search || categoryFilter) && (
              <button
                type="button"
                onClick={() => { handleSearch(''); setCategoryFilter(''); }}
                className="text-sm text-gray-500 hover:text-gray-700"
              >
                Clear filters
              </button>
            )}
          </div>

          {/* Error */}
          {error && (
            <div className="rounded-lg bg-red-50 border border-red-200 p-4 text-sm text-red-700">
              Failed to load prompts: {error}
            </div>
          )}

          {/* Loading */}
          {loading && (
            <div className="flex items-center justify-center py-12">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-brand-600" />
            </div>
          )}

          {/* Empty */}
          {!loading && !error && templates.length === 0 && (
            <div className="text-center py-12">
              <span className="text-4xl">📝</span>
              <h3 className="mt-3 text-sm font-semibold text-gray-900">No prompt templates</h3>
              <p className="mt-1 text-sm text-gray-500">
                {debouncedSearch || categoryFilter
                  ? 'No templates match your filters.'
                  : 'Get started by creating your first prompt template.'}
              </p>
              {!debouncedSearch && !categoryFilter && (
                <button
                  type="button"
                  onClick={() => setShowCreate(true)}
                  className="mt-4 inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-brand-600 text-white text-sm font-medium hover:bg-brand-700 transition-colors"
                >
                  Create Template
                </button>
              )}
            </div>
          )}

          {/* Table */}
          {!loading && !error && templates.length > 0 && (
            <>
              <div className="overflow-x-auto rounded-lg border border-gray-200">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Name</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Category</th>
                      <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Version</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Updated</th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {templates.map((t: PromptTemplate) => (
                      <tr
                        key={t.id}
                        onClick={() => navigate(`/prompts/${t.id}`)}
                        className="hover:bg-gray-50 cursor-pointer transition-colors"
                      >
                        <td className="px-4 py-3">
                          <div className="text-sm font-medium text-gray-900">{t.name}</div>
                          {t.description && (
                            <div className="text-xs text-gray-500 truncate max-w-xs">{t.description}</div>
                          )}
                        </td>
                        <td className="px-4 py-3">{categoryBadge(t.category)}</td>
                        <td className="px-4 py-3 text-sm text-right text-gray-600">v{t.currentVersionNumber}</td>
                        <td className="px-4 py-3 text-sm text-gray-500">{formatDate(t.updatedAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Pagination */}
              {totalPages > 1 && (
                <div className="flex items-center justify-between">
                  <p className="text-sm text-gray-500">
                    Showing {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, total)} of {total}
                  </p>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      disabled={page === 0}
                      onClick={() => setPage((p) => Math.max(0, p - 1))}
                      className="px-3 py-1.5 text-sm rounded-md border border-gray-300 text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                    >
                      Previous
                    </button>
                    <button
                      type="button"
                      disabled={page >= totalPages - 1}
                      onClick={() => setPage((p) => p + 1)}
                      className="px-3 py-1.5 text-sm rounded-md border border-gray-300 text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                    >
                      Next
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </>
      )}

      {/* Discovered prompts tab */}
      {tab === 'discovered' && (
        <>
          {fpError && (
            <div className="rounded-lg bg-red-50 border border-red-200 p-4 text-sm text-red-700">
              Failed to load fingerprints: {fpError}
            </div>
          )}
          {fpLoading && (
            <div className="flex items-center justify-center py-12">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-brand-600" />
            </div>
          )}
          {!fpLoading && !fpError && (fingerprints ?? []).length === 0 && (
            <div className="text-center py-12">
              <span className="text-4xl">🔍</span>
              <h3 className="mt-3 text-sm font-semibold text-gray-900">No discovered prompts</h3>
              <p className="mt-1 text-sm text-gray-500">
                Prompts will appear here automatically as agents make LLM calls.
              </p>
            </div>
          )}
          {!fpLoading && !fpError && (fingerprints ?? []).length > 0 && (
            <div className="space-y-3">
              {(fingerprints ?? []).map((fp) => (
                <div
                  key={`${fp.contentHash}-${fp.agentId}`}
                  className="rounded-lg border border-gray-200 bg-white p-4"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 text-xs text-gray-500">
                        <span>Agent: <span className="font-mono">{fp.agentId}</span></span>
                        <span>·</span>
                        <span>{fp.callCount} calls</span>
                        <span>·</span>
                        <span>First: {formatDate(fp.firstSeenAt)}</span>
                        <span>·</span>
                        <span>Last: {formatDate(fp.lastSeenAt)}</span>
                      </div>
                      {fp.sampleContent && (
                        <pre className="mt-2 text-xs text-gray-700 bg-gray-50 rounded p-2 overflow-x-auto max-h-24 whitespace-pre-wrap">
                          {fp.sampleContent.slice(0, 300)}
                          {fp.sampleContent.length > 300 ? '…' : ''}
                        </pre>
                      )}
                    </div>
                    {fp.templateId ? (
                      <span className="text-xs text-green-600 font-medium">Linked ✓</span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => {
                          const templateId = prompt('Enter template ID to link:');
                          if (templateId) {
                            linkFingerprintToTemplate(fp.contentHash, templateId).then(() => {
                              // Refetch by switching tabs
                              setTab('templates');
                              setTimeout(() => setTab('discovered'), 100);
                            });
                          }
                        }}
                        className="text-xs text-brand-600 hover:text-brand-800 font-medium whitespace-nowrap"
                      >
                        Link to Template
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {/* Create modal */}
      {showCreate && (
        <CreatePromptModal
          onClose={() => setShowCreate(false)}
          onCreated={() => refetch()}
        />
      )}
    </div>
  );
}
