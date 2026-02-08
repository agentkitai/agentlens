/**
 * Benchmark List Page (Story 6.1)
 *
 * Route: /benchmarks
 *
 * Features:
 *  - Table of benchmarks: Name, Status badge, Variants count, Sessions total, Created, Actions
 *  - Status filter tabs: All, Draft, Running, Completed, Cancelled
 *  - "New Benchmark" button → /benchmarks/new
 *  - Row click → /benchmarks/:id
 *  - Actions: View, Start (if draft), Cancel (if running), Delete (if draft/cancelled)
 *  - Loading/empty states, pagination
 */
import React, { useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApi } from '../hooks/useApi';
import {
  getBenchmarks,
  updateBenchmarkStatus,
  deleteBenchmark as deleteBenchmarkApi,
} from '../api/client';
import type { BenchmarkStatus, BenchmarkData } from '../api/client';

// ─── Constants ──────────────────────────────────────────────────────

const PAGE_SIZE = 20;

const STATUS_TABS: { label: string; value: BenchmarkStatus | 'all' }[] = [
  { label: 'All', value: 'all' },
  { label: 'Draft', value: 'draft' },
  { label: 'Running', value: 'running' },
  { label: 'Completed', value: 'completed' },
  { label: 'Cancelled', value: 'cancelled' },
];

// ─── Helpers ────────────────────────────────────────────────────────

function statusBadge(status: BenchmarkStatus): React.ReactElement {
  const styles: Record<BenchmarkStatus, string> = {
    completed: 'bg-green-100 text-green-800',
    running: 'bg-blue-100 text-blue-800',
    draft: 'bg-gray-100 text-gray-600',
    cancelled: 'bg-red-100 text-red-800',
  };
  return (
    <span
      className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${styles[status] || 'bg-gray-100 text-gray-600'}`}
    >
      {status.charAt(0).toUpperCase() + status.slice(1)}
    </span>
  );
}

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

// ─── Component ──────────────────────────────────────────────────────

export function Benchmarks(): React.ReactElement {
  const navigate = useNavigate();
  const [statusFilter, setStatusFilter] = useState<BenchmarkStatus | 'all'>('all');
  const [page, setPage] = useState(0);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const { data, loading, error, refetch } = useApi(
    () =>
      getBenchmarks({
        status: statusFilter === 'all' ? undefined : statusFilter,
        limit: PAGE_SIZE,
        offset: page * PAGE_SIZE,
      }),
    [statusFilter, page],
  );

  const handleTabChange = useCallback((tab: BenchmarkStatus | 'all') => {
    setStatusFilter(tab);
    setPage(0);
  }, []);

  const handleStart = useCallback(
    async (e: React.MouseEvent, id: string) => {
      e.stopPropagation();
      setActionLoading(id);
      try {
        await updateBenchmarkStatus(id, 'running');
        refetch();
      } catch (err) {
        console.error('Failed to start benchmark:', err);
      } finally {
        setActionLoading(null);
      }
    },
    [refetch],
  );

  const handleCancel = useCallback(
    async (e: React.MouseEvent, id: string) => {
      e.stopPropagation();
      setActionLoading(id);
      try {
        await updateBenchmarkStatus(id, 'cancelled');
        refetch();
      } catch (err) {
        console.error('Failed to cancel benchmark:', err);
      } finally {
        setActionLoading(null);
      }
    },
    [refetch],
  );

  const handleDelete = useCallback(
    async (e: React.MouseEvent, id: string) => {
      e.stopPropagation();
      if (!confirm('Delete this benchmark? This cannot be undone.')) return;
      setActionLoading(id);
      try {
        await deleteBenchmarkApi(id);
        refetch();
      } catch (err) {
        console.error('Failed to delete benchmark:', err);
      } finally {
        setActionLoading(null);
      }
    },
    [refetch],
  );

  const benchmarks = data?.benchmarks ?? [];
  const total = data?.total ?? 0;
  const hasMore = data?.hasMore ?? false;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Benchmarks</h2>
          <p className="mt-1 text-sm text-gray-500">
            Compare agent configurations with A/B testing
          </p>
        </div>
        <button
          type="button"
          onClick={() => navigate('/benchmarks/new')}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-brand-600 text-white text-sm font-medium hover:bg-brand-700 transition-colors"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
          </svg>
          New Benchmark
        </button>
      </div>

      {/* Status filter tabs */}
      <div className="border-b border-gray-200">
        <nav className="-mb-px flex gap-4" aria-label="Status filter">
          {STATUS_TABS.map((tab) => (
            <button
              key={tab.value}
              type="button"
              onClick={() => handleTabChange(tab.value)}
              className={`pb-3 px-1 text-sm font-medium border-b-2 transition-colors ${
                statusFilter === tab.value
                  ? 'border-brand-600 text-brand-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </nav>
      </div>

      {/* Error */}
      {error && (
        <div className="rounded-lg bg-red-50 border border-red-200 p-4 text-sm text-red-700">
          Failed to load benchmarks: {error}
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div className="flex items-center justify-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-brand-600" />
        </div>
      )}

      {/* Empty state */}
      {!loading && !error && benchmarks.length === 0 && (
        <div className="text-center py-12">
          <svg
            className="mx-auto h-12 w-12 text-gray-400"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={1}
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M9.75 3.104v5.714a2.25 2.25 0 01-.659 1.591L5 14.5M9.75 3.104c-.251.023-.501.05-.75.082m.75-.082a24.301 24.301 0 014.5 0m0 0v5.714c0 .597.237 1.17.659 1.591L19.8 15.3M14.25 3.104c.251.023.501.05.75.082M19.8 15.3l-1.57.393A9.065 9.065 0 0112 15a9.065 9.065 0 00-6.23.693L5 14.5m14.8.8l1.402 1.402c1.232 1.232.65 3.318-1.067 3.611A48.309 48.309 0 0112 21c-2.773 0-5.491-.235-8.135-.687-1.718-.293-2.3-2.379-1.067-3.61L5 14.5"
            />
          </svg>
          <h3 className="mt-3 text-sm font-semibold text-gray-900">No benchmarks</h3>
          <p className="mt-1 text-sm text-gray-500">
            {statusFilter === 'all'
              ? 'Get started by creating your first A/B benchmark.'
              : `No ${statusFilter} benchmarks found.`}
          </p>
          {statusFilter === 'all' && (
            <button
              type="button"
              onClick={() => navigate('/benchmarks/new')}
              className="mt-4 inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-brand-600 text-white text-sm font-medium hover:bg-brand-700 transition-colors"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
              </svg>
              New Benchmark
            </button>
          )}
        </div>
      )}

      {/* Table */}
      {!loading && !error && benchmarks.length > 0 && (
        <>
          <div className="overflow-x-auto rounded-lg border border-gray-200">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Name
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Status
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Variants
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Sessions
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Created
                  </th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {benchmarks.map((b: BenchmarkData) => (
                  <tr
                    key={b.id}
                    onClick={() => navigate(`/benchmarks/${b.id}`)}
                    className="hover:bg-gray-50 cursor-pointer transition-colors"
                  >
                    <td className="px-4 py-3 text-sm font-medium text-gray-900 whitespace-nowrap">
                      {b.name}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">{statusBadge(b.status)}</td>
                    <td className="px-4 py-3 text-sm text-gray-600 whitespace-nowrap">
                      {b.variants?.length ?? 0}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-600 whitespace-nowrap">
                      {b.totalSessions ?? 0}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-500 whitespace-nowrap">
                      {formatDate(b.createdAt)}
                    </td>
                    <td className="px-4 py-3 text-right whitespace-nowrap">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            navigate(`/benchmarks/${b.id}`);
                          }}
                          className="text-xs text-brand-600 hover:text-brand-800 font-medium"
                        >
                          View
                        </button>
                        {b.status === 'draft' && (
                          <button
                            type="button"
                            onClick={(e) => handleStart(e, b.id)}
                            disabled={actionLoading === b.id}
                            className="text-xs text-green-600 hover:text-green-800 font-medium disabled:opacity-50"
                          >
                            Start
                          </button>
                        )}
                        {b.status === 'running' && (
                          <button
                            type="button"
                            onClick={(e) => handleCancel(e, b.id)}
                            disabled={actionLoading === b.id}
                            className="text-xs text-yellow-600 hover:text-yellow-800 font-medium disabled:opacity-50"
                          >
                            Cancel
                          </button>
                        )}
                        {(b.status === 'draft' || b.status === 'cancelled') && (
                          <button
                            type="button"
                            onClick={(e) => handleDelete(e, b.id)}
                            disabled={actionLoading === b.id}
                            className="text-xs text-red-600 hover:text-red-800 font-medium disabled:opacity-50"
                          >
                            Delete
                          </button>
                        )}
                      </div>
                    </td>
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
                  className="px-3 py-1.5 text-sm rounded-md border border-gray-300 text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Previous
                </button>
                <button
                  type="button"
                  disabled={!hasMore}
                  onClick={() => setPage((p) => p + 1)}
                  className="px-3 py-1.5 text-sm rounded-md border border-gray-300 text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
