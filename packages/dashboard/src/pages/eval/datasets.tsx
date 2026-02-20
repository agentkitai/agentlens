/**
 * Eval Dataset List Page (Feature 15 — Story 13)
 *
 * Route: /eval/datasets
 *
 * Features:
 *  - Table of datasets: Name, Agent, Version, Test Cases, Created
 *  - "New Dataset" button → create dialog
 *  - Row click → /eval/datasets/:id
 *  - Filter by agent dropdown
 */
import React, { useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApi } from '../../hooks/useApi';
import { getEvalDatasets, createEvalDataset } from '../../api/eval';
import { getAgents } from '../../api/client';
import type { EvalDataset } from '../../api/eval';
import type { Agent } from '@agentlensai/core';

const PAGE_SIZE = 20;

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

export function EvalDatasets(): React.ReactElement {
  const navigate = useNavigate();
  const [agentFilter, setAgentFilter] = useState('');
  const [page, setPage] = useState(0);
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [newAgentId, setNewAgentId] = useState('');
  const [creating, setCreating] = useState(false);

  const { data, loading, error, refetch } = useApi(
    () =>
      getEvalDatasets({
        agentId: agentFilter || undefined,
        limit: PAGE_SIZE,
        offset: page * PAGE_SIZE,
      }),
    [agentFilter, page],
  );

  const { data: agents } = useApi(() => getAgents(), []);

  const handleCreate = useCallback(async () => {
    if (!newName.trim()) return;
    setCreating(true);
    try {
      const dataset = await createEvalDataset({
        name: newName.trim(),
        description: newDesc.trim() || undefined,
        agentId: newAgentId || undefined,
      });
      setShowCreate(false);
      setNewName('');
      setNewDesc('');
      setNewAgentId('');
      navigate(`/eval/datasets/${dataset.id}`);
    } catch {
      // Error handled by UI
    } finally {
      setCreating(false);
    }
  }, [newName, newDesc, newAgentId, navigate]);

  const datasets = data?.datasets ?? [];
  const total = data?.total ?? 0;
  const hasMore = data?.hasMore ?? false;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Eval Datasets</h1>
          <p className="text-sm text-gray-500 mt-1">
            Manage evaluation datasets and test cases for quality testing.
          </p>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 transition-colors"
        >
          New Dataset
        </button>
      </div>

      {/* Filter */}
      <div className="flex items-center gap-3 rounded-lg border border-gray-200 bg-white p-3">
        <select
          value={agentFilter}
          onChange={(e) => {
            setAgentFilter(e.target.value);
            setPage(0);
          }}
          className="rounded border border-gray-300 bg-white px-3 py-1.5 text-sm"
        >
          <option value="">All Agents</option>
          {(agents ?? []).map((a: Agent) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
        {agentFilter && (
          <button
            onClick={() => {
              setAgentFilter('');
              setPage(0);
            }}
            className="text-sm text-gray-500 hover:text-gray-700"
          >
            Clear
          </button>
        )}
      </div>

      {/* Error */}
      {error && (
        <div className="p-4 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
          Error loading datasets: {error}
        </div>
      )}

      {/* Create Dialog */}
      {showCreate && (
        <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm space-y-4">
          <h3 className="text-base font-semibold text-gray-900">Create New Dataset</h3>
          <div className="space-y-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Name *</label>
              <input
                type="text"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="e.g., Customer Support QA v1"
                className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
              <textarea
                value={newDesc}
                onChange={(e) => setNewDesc(e.target.value)}
                placeholder="Optional description..."
                rows={2}
                className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Agent</label>
              <select
                value={newAgentId}
                onChange={(e) => setNewAgentId(e.target.value)}
                className="rounded border border-gray-300 bg-white px-3 py-1.5 text-sm"
              >
                <option value="">No specific agent</option>
                {(agents ?? []).map((a: Agent) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="flex gap-2 justify-end">
            <button
              onClick={() => setShowCreate(false)}
              className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              onClick={handleCreate}
              disabled={!newName.trim() || creating}
              className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
            >
              {creating ? 'Creating...' : 'Create'}
            </button>
          </div>
        </div>
      )}

      {/* Table */}
      {loading && !data ? (
        <div className="space-y-3">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="h-14 animate-pulse rounded-lg bg-gray-100" />
          ))}
        </div>
      ) : datasets.length === 0 ? (
        <div className="rounded-xl border border-gray-200 bg-white p-12 text-center shadow-sm">
          <span className="text-4xl">📋</span>
          <h3 className="mt-4 text-lg font-semibold text-gray-900">No eval datasets yet</h3>
          <p className="mt-2 text-sm text-gray-500 max-w-md mx-auto">
            Create your first dataset to start evaluating agent quality.
          </p>
        </div>
      ) : (
        <div className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">
                  Name
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">
                  Agent
                </th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase">
                  Version
                </th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase">
                  Test Cases
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">
                  Created
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {datasets.map((ds) => (
                <tr
                  key={ds.id}
                  onClick={() => navigate(`/eval/datasets/${ds.id}`)}
                  className="hover:bg-gray-50 cursor-pointer"
                >
                  <td className="px-4 py-3 text-sm font-medium text-gray-900">
                    {ds.name}
                    {ds.description && (
                      <span className="ml-2 text-xs text-gray-400">{ds.description}</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-600">
                    {ds.agentId || '—'}
                  </td>
                  <td className="px-4 py-3 text-sm text-right text-gray-600">
                    v{ds.version}
                  </td>
                  <td className="px-4 py-3 text-sm text-right text-gray-600">
                    {ds.testCaseCount ?? 0}
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-500">
                    {formatDate(ds.createdAt)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* Pagination */}
          {(page > 0 || hasMore) && (
            <div className="flex items-center justify-between px-4 py-3 border-t border-gray-200">
              <span className="text-sm text-gray-500">
                Showing {page * PAGE_SIZE + 1}–{page * PAGE_SIZE + datasets.length} of {total}
              </span>
              <div className="flex gap-2">
                <button
                  onClick={() => setPage((p) => Math.max(0, p - 1))}
                  disabled={page === 0}
                  className="rounded border px-3 py-1 text-sm disabled:opacity-40"
                >
                  Previous
                </button>
                <button
                  onClick={() => setPage((p) => p + 1)}
                  disabled={!hasMore}
                  className="rounded border px-3 py-1 text-sm disabled:opacity-40"
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
