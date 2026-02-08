/**
 * Benchmark Detail & Results Page (Story 6.3)
 *
 * Route: /benchmarks/:id
 *
 * Features:
 *  - Header: name, status badge, description, action buttons
 *  - Variant cards with progress bars
 *  - ComparisonTable: statistical results
 *  - Summary card: plain-language recommendation
 *  - Warning banner for insufficient sample size
 *  - Auto-refresh every 30s for running benchmarks
 *  - Confirmation dialogs for status changes
 *  - Distribution charts toggle (Story 6.4)
 *  - 404 for invalid ID
 */
import React, { useState, useCallback, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useApi } from '../hooks/useApi';
import {
  getBenchmark,
  getBenchmarkResults,
  updateBenchmarkStatus,
  deleteBenchmark as deleteBenchmarkApi,
} from '../api/client';
import type { BenchmarkStatus, BenchmarkData, BenchmarkResultsData } from '../api/client';
import { ComparisonTable } from '../components/benchmark/ComparisonTable';
import { DistributionChart } from '../components/benchmark/DistributionChart';
import type { VariantDistribution } from '../components/benchmark/DistributionChart';

// ─── Constants ──────────────────────────────────────────────────────

const REFRESH_INTERVAL_MS = 30_000;
const MIN_SAMPLE_SIZE = 30;

const VARIANT_COLORS = [
  '#6366f1', // indigo
  '#f59e0b', // amber
  '#10b981', // emerald
  '#ef4444', // red
  '#8b5cf6', // violet
  '#06b6d4', // cyan
  '#f97316', // orange
  '#ec4899', // pink
  '#14b8a6', // teal
  '#84cc16', // lime
];

const METRIC_LABELS: Record<string, string> = {
  cost_per_session: 'Cost per Session',
  avg_latency: 'Average Latency',
  error_rate: 'Error Rate',
  tool_call_count: 'Tool Call Count',
  tokens_per_session: 'Tokens per Session',
  session_duration: 'Session Duration',
  task_completion: 'Task Completion',
  user_satisfaction: 'User Satisfaction',
};

function metricLabel(metric: string): string {
  return METRIC_LABELS[metric] || metric.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

// ─── Status Badge ───────────────────────────────────────────────────

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

// ─── Confirmation Dialog ────────────────────────────────────────────

function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel,
  confirmColor,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  message: string;
  confirmLabel: string;
  confirmColor: string;
  onConfirm: () => void;
  onCancel: () => void;
}): React.ReactElement | null {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-xl shadow-xl p-6 max-w-sm w-full mx-4 space-y-4">
        <h3 className="text-lg font-semibold text-gray-900">{title}</h3>
        <p className="text-sm text-gray-600">{message}</p>
        <div className="flex justify-end gap-3">
          <button
            type="button"
            onClick={onCancel}
            className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className={`px-4 py-2 text-sm font-medium text-white rounded-lg ${confirmColor}`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Component ──────────────────────────────────────────────────────

export function BenchmarkDetail(): React.ReactElement {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  // ─── Data fetching ──────────────────────────────────────────────

  const {
    data: benchmark,
    loading: benchLoading,
    error: benchError,
    refetch: refetchBenchmark,
  } = useApi(() => getBenchmark(id!), [id]);

  const {
    data: results,
    loading: resultsLoading,
    error: resultsError,
    refetch: refetchResults,
  } = useApi(() => getBenchmarkResults(id!), [id]);

  // ─── Distribution data (lazy-loaded) ───────────────────────────

  const [showDistributions, setShowDistributions] = useState(false);
  const [distData, setDistData] = useState<BenchmarkResultsData | null>(null);
  const [distLoading, setDistLoading] = useState(false);
  const distFetched = useRef(false);

  useEffect(() => {
    if (showDistributions && !distFetched.current && id) {
      distFetched.current = true;
      setDistLoading(true);
      getBenchmarkResults(id, { includeDistributions: true })
        .then(setDistData)
        .catch(console.error)
        .finally(() => setDistLoading(false));
    }
  }, [showDistributions, id]);

  // ─── Auto-refresh for running benchmarks ────────────────────────

  useEffect(() => {
    if (benchmark?.status !== 'running') return;
    const timer = setInterval(() => {
      refetchBenchmark();
      refetchResults();
    }, REFRESH_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [benchmark?.status, refetchBenchmark, refetchResults]);

  // ─── Action state ───────────────────────────────────────────────

  const [actionLoading, setActionLoading] = useState(false);
  const [confirmDialog, setConfirmDialog] = useState<{
    title: string;
    message: string;
    confirmLabel: string;
    confirmColor: string;
    action: () => Promise<void>;
  } | null>(null);

  const handleStatusChange = useCallback(
    (newStatus: BenchmarkStatus, title: string, message: string) => {
      setConfirmDialog({
        title,
        message,
        confirmLabel: title,
        confirmColor:
          newStatus === 'running'
            ? 'bg-green-600 hover:bg-green-700'
            : newStatus === 'completed'
              ? 'bg-blue-600 hover:bg-blue-700'
              : 'bg-red-600 hover:bg-red-700',
        action: async () => {
          setActionLoading(true);
          try {
            await updateBenchmarkStatus(id!, newStatus);
            refetchBenchmark();
            refetchResults();
          } catch (err) {
            console.error('Status change failed:', err);
          } finally {
            setActionLoading(false);
          }
        },
      });
    },
    [id, refetchBenchmark, refetchResults],
  );

  const handleDelete = useCallback(() => {
    setConfirmDialog({
      title: 'Delete Benchmark',
      message:
        'This will permanently delete this benchmark and all its data. This cannot be undone.',
      confirmLabel: 'Delete',
      confirmColor: 'bg-red-600 hover:bg-red-700',
      action: async () => {
        setActionLoading(true);
        try {
          await deleteBenchmarkApi(id!);
          navigate('/benchmarks');
        } catch (err) {
          console.error('Delete failed:', err);
        } finally {
          setActionLoading(false);
        }
      },
    });
  }, [id, navigate]);

  const confirmAction = useCallback(async () => {
    if (confirmDialog) {
      await confirmDialog.action();
      setConfirmDialog(null);
    }
  }, [confirmDialog]);

  // ─── Loading / Error / 404 ──────────────────────────────────────

  if (benchLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-brand-600" />
      </div>
    );
  }

  if (benchError) {
    // Check for 404
    const is404 =
      benchError.includes('404') || benchError.includes('not found') || benchError.includes('Not Found');
    if (is404) {
      return (
        <div className="text-center py-20 space-y-4">
          <div className="text-6xl">🔍</div>
          <h2 className="text-2xl font-bold text-gray-900">Benchmark Not Found</h2>
          <p className="text-gray-500">
            The benchmark you&apos;re looking for doesn&apos;t exist or has been deleted.
          </p>
          <button
            type="button"
            onClick={() => navigate('/benchmarks')}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-brand-600 text-white text-sm font-medium hover:bg-brand-700"
          >
            Back to Benchmarks
          </button>
        </div>
      );
    }

    return (
      <div className="rounded-lg bg-red-50 border border-red-200 p-4 text-sm text-red-700">
        Failed to load benchmark: {benchError}
      </div>
    );
  }

  if (!benchmark) {
    return (
      <div className="text-center py-20 space-y-4">
        <div className="text-6xl">🔍</div>
        <h2 className="text-2xl font-bold text-gray-900">Benchmark Not Found</h2>
        <p className="text-gray-500">
          The benchmark you&apos;re looking for doesn&apos;t exist.
        </p>
        <button
          type="button"
          onClick={() => navigate('/benchmarks')}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-brand-600 text-white text-sm font-medium hover:bg-brand-700"
        >
          Back to Benchmarks
        </button>
      </div>
    );
  }

  // ─── Derived state ──────────────────────────────────────────────

  const hasInsufficientData = benchmark.variants.some(
    (v) => (v.sessionCount ?? 0) < MIN_SAMPLE_SIZE,
  );

  const variantNames = benchmark.variants.map((v, i) => ({
    id: v.id ?? `variant-${i}`,
    name: v.name,
  }));

  // ─── Render ─────────────────────────────────────────────────────

  return (
    <div className="space-y-6">
      {/* Confirmation dialog */}
      <ConfirmDialog
        open={confirmDialog !== null}
        title={confirmDialog?.title ?? ''}
        message={confirmDialog?.message ?? ''}
        confirmLabel={confirmDialog?.confirmLabel ?? ''}
        confirmColor={confirmDialog?.confirmColor ?? ''}
        onConfirm={confirmAction}
        onCancel={() => setConfirmDialog(null)}
      />

      {/* Back link + header */}
      <div>
        <button
          type="button"
          onClick={() => navigate('/benchmarks')}
          className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 mb-4"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
          </svg>
          Back to Benchmarks
        </button>

        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-3">
              <h2 className="text-2xl font-bold text-gray-900">{benchmark.name}</h2>
              {statusBadge(benchmark.status)}
            </div>
            {benchmark.description && (
              <p className="text-sm text-gray-500 max-w-2xl">{benchmark.description}</p>
            )}
            <p className="text-xs text-gray-400">
              Created {new Date(benchmark.createdAt).toLocaleDateString()} · {benchmark.totalSessions} total sessions
              {benchmark.agentName && ` · Agent: ${benchmark.agentName}`}
            </p>
          </div>

          {/* Action buttons */}
          <div className="flex items-center gap-2 shrink-0">
            {benchmark.status === 'draft' && (
              <button
                type="button"
                disabled={actionLoading}
                onClick={() =>
                  handleStatusChange(
                    'running',
                    'Start Benchmark',
                    'Start collecting sessions for this benchmark? Sessions tagged with variant tags will be automatically assigned.',
                  )
                }
                className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-white bg-green-600 rounded-lg hover:bg-green-700 disabled:opacity-50"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5.25 5.653c0-.856.917-1.398 1.667-.986l11.54 6.348a1.125 1.125 0 010 1.971l-11.54 6.347a1.125 1.125 0 01-1.667-.985V5.653z" />
                </svg>
                Start
              </button>
            )}
            {benchmark.status === 'running' && (
              <>
                <button
                  type="button"
                  disabled={actionLoading}
                  onClick={() =>
                    handleStatusChange(
                      'completed',
                      'Complete Benchmark',
                      'Mark this benchmark as complete? No more sessions will be collected. Results will be finalized.',
                    )
                  }
                  className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  Complete
                </button>
                <button
                  type="button"
                  disabled={actionLoading}
                  onClick={() =>
                    handleStatusChange(
                      'cancelled',
                      'Cancel Benchmark',
                      'Cancel this benchmark? Collected data will be preserved but no more sessions will be assigned.',
                    )
                  }
                  className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-red-700 bg-red-50 border border-red-200 rounded-lg hover:bg-red-100 disabled:opacity-50"
                >
                  Cancel
                </button>
              </>
            )}
            {(benchmark.status === 'draft' || benchmark.status === 'cancelled') && (
              <button
                type="button"
                disabled={actionLoading}
                onClick={handleDelete}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-red-700 bg-red-50 border border-red-200 rounded-lg hover:bg-red-100 disabled:opacity-50"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
                </svg>
                Delete
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Insufficient data warning */}
      {hasInsufficientData && (benchmark.status === 'running' || benchmark.status === 'completed') && (
        <div className="rounded-lg bg-amber-50 border border-amber-200 p-4 flex items-start gap-3">
          <svg className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
          </svg>
          <div>
            <h4 className="text-sm font-semibold text-amber-800">Insufficient Sample Size</h4>
            <p className="text-sm text-amber-700 mt-0.5">
              One or more variants have fewer than {MIN_SAMPLE_SIZE} sessions. Results may be unreliable — collect more data for statistically significant comparisons.
            </p>
          </div>
        </div>
      )}

      {/* Variant cards */}
      <section className="space-y-3">
        <h3 className="text-lg font-semibold text-gray-900">Variants</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {benchmark.variants.map((v, idx) => {
            const sessions = v.sessionCount ?? 0;
            const target = benchmark.minSessions;
            const progress = target > 0 ? Math.min((sessions / target) * 100, 100) : 0;
            const color = VARIANT_COLORS[idx % VARIANT_COLORS.length];

            return (
              <div
                key={v.id ?? idx}
                className="rounded-lg border border-gray-200 bg-white p-4 space-y-3"
              >
                <div className="flex items-start justify-between">
                  <div>
                    <h4 className="text-sm font-semibold text-gray-900">{v.name}</h4>
                    {v.description && (
                      <p className="text-xs text-gray-500 mt-0.5">{v.description}</p>
                    )}
                  </div>
                  <span
                    className="inline-flex items-center px-2 py-0.5 rounded text-xs font-mono"
                    style={{
                      backgroundColor: color + '15',
                      color,
                      border: `1px solid ${color}40`,
                    }}
                  >
                    {v.tag}
                  </span>
                </div>

                {/* Session count & progress */}
                <div className="space-y-1.5">
                  <div className="flex items-baseline justify-between">
                    <span className="text-2xl font-bold text-gray-900">{sessions}</span>
                    <span className="text-xs text-gray-400">/ {target} sessions</span>
                  </div>
                  <div className="w-full bg-gray-100 rounded-full h-2 overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all duration-500"
                      style={{
                        width: `${progress}%`,
                        backgroundColor: color,
                      }}
                    />
                  </div>
                  {sessions < MIN_SAMPLE_SIZE && (benchmark.status === 'running' || benchmark.status === 'completed') && (
                    <p className="text-xs text-amber-600">
                      ⚠ Below {MIN_SAMPLE_SIZE} sessions
                    </p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* Comparison table */}
      <section className="space-y-3">
        <h3 className="text-lg font-semibold text-gray-900">Results Comparison</h3>
        {resultsLoading ? (
          <div className="flex items-center justify-center py-8">
            <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-brand-600" />
          </div>
        ) : resultsError ? (
          <div className="rounded-lg bg-red-50 border border-red-200 p-4 text-sm text-red-700">
            Failed to load results: {resultsError}
          </div>
        ) : (
          <ComparisonTable
            metrics={results?.metrics ?? []}
            variantNames={variantNames}
          />
        )}
      </section>

      {/* Summary card */}
      {results?.summary && (
        <section className="rounded-lg border border-gray-200 bg-gradient-to-r from-brand-50 to-white p-5 space-y-3">
          <h3 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
            <svg className="w-5 h-5 text-brand-600" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z" />
            </svg>
            Summary
          </h3>
          <p className="text-sm text-gray-700 leading-relaxed">
            {results.summary.recommendation}
          </p>
          {results.summary.details && results.summary.details.length > 0 && (
            <ul className="text-sm text-gray-600 space-y-1 ml-4">
              {results.summary.details.map((d, i) => (
                <li key={i} className="list-disc">
                  {d}
                </li>
              ))}
            </ul>
          )}
          {results.summary.winnerName && (
            <p className="text-sm font-medium text-brand-700">
              Winner: {results.summary.winnerName}
              {' '}
              <span className="text-yellow-500">
                {results.summary.confidence >= 0.99
                  ? '★★★'
                  : results.summary.confidence >= 0.95
                    ? '★★'
                    : results.summary.confidence >= 0.9
                      ? '★'
                      : '—'}
              </span>
            </p>
          )}
        </section>
      )}

      {/* Distribution charts (Story 6.4) */}
      {(benchmark.status === 'running' || benchmark.status === 'completed') && (
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-semibold text-gray-900">Distributions</h3>
            <button
              type="button"
              onClick={() => setShowDistributions((prev) => !prev)}
              className="inline-flex items-center gap-2 text-sm font-medium text-brand-600 hover:text-brand-800"
            >
              <svg
                className={`w-4 h-4 transition-transform ${showDistributions ? 'rotate-180' : ''}`}
                fill="none"
                viewBox="0 0 24 24"
                strokeWidth={2}
                stroke="currentColor"
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
              </svg>
              {showDistributions ? 'Hide' : 'Show'} Distributions
            </button>
          </div>

          {showDistributions && (
            <div className="space-y-6">
              {distLoading ? (
                <div className="flex items-center justify-center py-8">
                  <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-brand-600" />
                </div>
              ) : distData ? (
                distData.metrics.map((m) => {
                  const variantDists: VariantDistribution[] = m.variantResults
                    .filter((vr) => vr.values && vr.values.length > 0)
                    .map((vr, vIdx) => {
                      // Find color by matching variant in original benchmark
                      const origIdx = benchmark.variants.findIndex(
                        (bv) => (bv.id ?? '') === vr.variantId || bv.name === vr.variantName,
                      );
                      return {
                        variantId: vr.variantId,
                        variantName: vr.variantName,
                        values: vr.values!,
                        color: VARIANT_COLORS[(origIdx >= 0 ? origIdx : vIdx) % VARIANT_COLORS.length],
                      };
                    });

                  if (variantDists.length === 0) return null;

                  return (
                    <DistributionChart
                      key={m.metric}
                      metric={m.metric}
                      metricLabel={metricLabel(m.metric)}
                      variants={variantDists}
                    />
                  );
                })
              ) : (
                <p className="text-sm text-gray-500">
                  No distribution data available. Make sure sessions have been collected.
                </p>
              )}
            </div>
          )}
        </section>
      )}

      {/* Auto-refresh indicator */}
      {benchmark.status === 'running' && (
        <p className="text-xs text-gray-400 text-center">
          Auto-refreshing every {REFRESH_INTERVAL_MS / 1000}s
        </p>
      )}
    </div>
  );
}
