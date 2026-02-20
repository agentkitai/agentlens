/**
 * DiagnosticPanel — AI Diagnostics display component (Story 18.10)
 *
 * Shows severity badge, AI label, summary, collapsible root causes with
 * evidence, recommendations with priority, and LLM metadata footer.
 */
import React, { useState } from 'react';
import type { DiagnosticReport, RootCause, Recommendation } from '../api/diagnose';

// ─── Severity styling ───────────────────────────────────────────

const SEVERITY_STYLES: Record<
  DiagnosticReport['severity'],
  { bg: string; text: string; border: string; icon: string }
> = {
  critical: { bg: 'bg-red-50', text: 'text-red-800', border: 'border-red-300', icon: '🔴' },
  warning: { bg: 'bg-orange-50', text: 'text-orange-800', border: 'border-orange-300', icon: '🟠' },
  info: { bg: 'bg-blue-50', text: 'text-blue-800', border: 'border-blue-300', icon: '🔵' },
  healthy: { bg: 'bg-green-50', text: 'text-green-800', border: 'border-green-300', icon: '🟢' },
};

const PRIORITY_STYLES: Record<Recommendation['priority'], { badge: string; label: string }> = {
  high: { badge: 'bg-red-100 text-red-700', label: 'HIGH' },
  medium: { badge: 'bg-yellow-100 text-yellow-700', label: 'MED' },
  low: { badge: 'bg-gray-100 text-gray-600', label: 'LOW' },
};

// ─── Sub-components ─────────────────────────────────────────────

function SeverityBadge({ severity }: { severity: DiagnosticReport['severity'] }) {
  const s = SEVERITY_STYLES[severity];
  return (
    <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-sm font-semibold border ${s.bg} ${s.text} ${s.border}`}>
      {s.icon} {severity.charAt(0).toUpperCase() + severity.slice(1)}
    </span>
  );
}

function ConfidenceBar({ confidence }: { confidence: number }) {
  const pct = Math.round(confidence * 100);
  const color =
    pct >= 75 ? 'bg-green-500' : pct >= 50 ? 'bg-yellow-500' : 'bg-red-500';
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 bg-gray-200 rounded-full h-2 max-w-[120px]">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs text-gray-500 font-mono w-8">{pct}%</span>
    </div>
  );
}

function RootCauseItem({ cause, index }: { cause: RootCause; index: number }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="border border-gray-200 rounded-lg">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-start gap-3 p-3 text-left hover:bg-gray-50 transition-colors"
      >
        <span className="text-sm font-semibold text-gray-400 mt-0.5">{index + 1}</span>
        <div className="flex-1 min-w-0">
          <p className="text-sm text-gray-900">{cause.description}</p>
          <div className="flex items-center gap-3 mt-1.5">
            <span className="inline-flex px-2 py-0.5 text-xs rounded-full bg-gray-100 text-gray-600">
              {cause.category.replace(/_/g, ' ')}
            </span>
            <ConfidenceBar confidence={cause.confidence} />
          </div>
        </div>
        <span className="text-gray-400 text-xs mt-1">{expanded ? '▲' : '▼'}</span>
      </button>
      {expanded && cause.evidence.length > 0 && (
        <div className="px-3 pb-3 pl-9 space-y-1">
          {cause.evidence.map((ev, i) => (
            <div key={i} className="flex items-start gap-2 text-xs text-gray-600">
              <span className="text-gray-400 mt-0.5">•</span>
              <span>{ev.summary}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function RecommendationItem({ rec }: { rec: Recommendation }) {
  const p = PRIORITY_STYLES[rec.priority];
  return (
    <div className="flex items-start gap-3 p-3 border border-gray-200 rounded-lg">
      <span className={`inline-flex px-2 py-0.5 text-xs font-semibold rounded ${p.badge}`}>
        {p.label}
      </span>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-gray-900">{rec.action}</p>
        <p className="text-xs text-gray-500 mt-0.5">{rec.rationale}</p>
      </div>
    </div>
  );
}

// ─── Loading skeleton ───────────────────────────────────────────

function DiagnosticSkeleton() {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm space-y-4 animate-pulse">
      <div className="flex items-center gap-3">
        <div className="h-7 w-24 bg-gray-200 rounded-full" />
        <div className="h-5 w-32 bg-gray-100 rounded" />
      </div>
      <div className="h-4 bg-gray-200 rounded w-3/4" />
      <div className="h-4 bg-gray-200 rounded w-1/2" />
      <div className="space-y-2">
        <div className="h-16 bg-gray-100 rounded" />
        <div className="h-16 bg-gray-100 rounded" />
      </div>
      <div className="text-xs text-gray-400 text-center">
        🧠 Running AI diagnostics… this may take 5–15 seconds
      </div>
    </div>
  );
}

// ─── Main component ─────────────────────────────────────────────

export interface DiagnosticPanelProps {
  report: DiagnosticReport | null;
  loading: boolean;
  error?: string | null;
  onRefresh?: () => void;
}

export function DiagnosticPanel({
  report,
  loading,
  error,
  onRefresh,
}: DiagnosticPanelProps): React.ReactElement {
  if (loading) return <DiagnosticSkeleton />;

  if (error) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-6">
        <p className="text-red-600 font-medium text-sm">Failed to run diagnostics</p>
        <p className="text-red-500 text-xs mt-1">{error}</p>
        {onRefresh && (
          <button
            type="button"
            onClick={onRefresh}
            className="mt-3 text-xs text-red-700 hover:text-red-900 font-medium"
          >
            ↻ Retry
          </button>
        )}
      </div>
    );
  }

  if (!report) return <></>;

  const isFallback = report.source === 'fallback';

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm space-y-5">
      {/* Header: severity + AI label + refresh */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-3">
          <SeverityBadge severity={report.severity} />
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-purple-100 text-purple-700">
            🤖 AI-suggested
          </span>
          {isFallback && (
            <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-yellow-100 text-yellow-700">
              ⚠️ AI diagnostics unavailable — heuristic analysis
            </span>
          )}
        </div>
        {onRefresh && (
          <button
            type="button"
            onClick={onRefresh}
            className="text-xs text-gray-500 hover:text-gray-700 font-medium"
          >
            ↻ Refresh
          </button>
        )}
      </div>

      {/* Health score */}
      {report.healthScore !== undefined && (
        <div className="text-sm text-gray-600">
          Health Score: <span className="font-semibold">{Math.round(report.healthScore)}/100</span>
        </div>
      )}

      {/* Summary */}
      <div>
        <h4 className="text-xs font-semibold text-gray-500 uppercase mb-1">Summary</h4>
        <p className="text-sm text-gray-800">{report.summary}</p>
      </div>

      {/* Root Causes */}
      {report.rootCauses.length > 0 && (
        <div>
          <h4 className="text-xs font-semibold text-gray-500 uppercase mb-2">
            Root Causes ({report.rootCauses.length})
          </h4>
          <div className="space-y-2">
            {report.rootCauses.map((cause, i) => (
              <RootCauseItem key={i} cause={cause} index={i} />
            ))}
          </div>
        </div>
      )}

      {/* Recommendations */}
      {report.recommendations.length > 0 && (
        <div>
          <h4 className="text-xs font-semibold text-gray-500 uppercase mb-2">
            Recommendations ({report.recommendations.length})
          </h4>
          <div className="space-y-2">
            {report.recommendations.map((rec, i) => (
              <RecommendationItem key={i} rec={rec} />
            ))}
          </div>
        </div>
      )}

      {/* LLM Metadata footer */}
      {!isFallback && (
        <div className="pt-3 border-t border-gray-100 flex flex-wrap gap-4 text-xs text-gray-400">
          <span>Provider: {report.llmMeta.provider}</span>
          <span>Model: {report.llmMeta.model}</span>
          <span>Tokens: {report.llmMeta.inputTokens + report.llmMeta.outputTokens}</span>
          <span>Cost: ${report.llmMeta.estimatedCostUsd.toFixed(4)}</span>
          <span>Latency: {(report.llmMeta.latencyMs / 1000).toFixed(1)}s</span>
        </div>
      )}

      {/* Analysis context */}
      <div className="text-xs text-gray-400">
        Based on {report.analysisContext.sessionCount} sessions,{' '}
        {report.analysisContext.dataPoints} data points
        {report.analysisContext.windowDays && ` over ${report.analysisContext.windowDays} days`}
      </div>
    </div>
  );
}
