/**
 * Health Overview Page (Story 3.4)
 *
 * Route: /health
 *
 * Features:
 *  - Grid of agent health cards
 *  - Each card: agent name, overall score, trend arrow, color coding
 *  - Color coding: green (≥75), yellow (50-74), red (<50)
 *  - Click card → expands to show dimension breakdown
 */
import React, { useState, useCallback } from 'react';
import { useApi } from '../hooks/useApi';
import { getHealthOverview, getAgents } from '../api/client';
import type { HealthOverviewData, AgentHealth } from '../api/client';
import { diagnoseAgent } from '../api/diagnose';
import type { DiagnosticReport } from '../api/diagnose';
import { DiagnosticPanel } from '../components/DiagnosticPanel';

// ─── Helpers ────────────────────────────────────────────────────────

function scoreColor(score: number): string {
  if (score >= 75) return 'text-green-600';
  if (score >= 50) return 'text-yellow-600';
  return 'text-red-600';
}

function scoreBg(score: number): string {
  if (score >= 75) return 'bg-green-50 border-green-200';
  if (score >= 50) return 'bg-yellow-50 border-yellow-200';
  return 'bg-red-50 border-red-200';
}

function scoreRingColor(score: number): string {
  if (score >= 75) return '#16a34a';
  if (score >= 50) return '#ca8a04';
  return '#dc2626';
}

function trendArrow(trend: string): { icon: string; label: string; color: string } {
  switch (trend) {
    case 'improving':
      return { icon: '↑', label: 'Improving', color: 'text-green-600' };
    case 'degrading':
      return { icon: '↓', label: 'Degrading', color: 'text-red-600' };
    default:
      return { icon: '→', label: 'Stable', color: 'text-gray-500' };
  }
}

function dimensionBarColor(score: number): string {
  if (score >= 75) return 'bg-green-500';
  if (score >= 50) return 'bg-yellow-500';
  return 'bg-red-500';
}

// ─── Circular Gauge ─────────────────────────────────────────────────

function CircularGauge({ score, size = 80 }: { score: number; size?: number }): React.ReactElement {
  const radius = (size - 8) / 2;
  const circumference = 2 * Math.PI * radius;
  const progress = Math.max(0, Math.min(100, score));
  const offset = circumference - (progress / 100) * circumference;

  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="transform -rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="#e5e7eb"
          strokeWidth={6}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={scoreRingColor(score)}
          strokeWidth={6}
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
          className="transition-all duration-500 ease-out"
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        <span className={`text-lg font-bold ${scoreColor(score)}`}>{Math.round(score)}</span>
      </div>
    </div>
  );
}

// ─── Dimension Breakdown ────────────────────────────────────────────

function DimensionBreakdown({ dimensions }: { dimensions: Record<string, number> }): React.ReactElement {
  const entries = Object.entries(dimensions)
    .filter(([, v]) => typeof v === 'number' && !isNaN(v))
    .sort((a, b) => b[1] - a[1]);

  if (entries.length === 0) {
    return <div className="text-sm text-gray-400 py-2">No dimension data available.</div>;
  }

  return (
    <div className="mt-4 pt-4 border-t border-gray-200 space-y-2">
      <h4 className="text-xs font-semibold text-gray-500 uppercase">Dimensions</h4>
      {entries.map(([name, value]) => (
        <div key={name} className="flex items-center gap-3">
          <span className="text-xs text-gray-600 w-28 truncate capitalize" title={name}>
            {name.replace(/_/g, ' ')}
          </span>
          <div className="flex-1 bg-gray-100 rounded-full h-2.5 overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-500 ${dimensionBarColor(value)}`}
              style={{ width: `${Math.max(0, Math.min(100, value))}%` }}
            />
          </div>
          <span className={`text-xs font-medium w-8 text-right ${scoreColor(value)}`}>
            {Math.round(value)}
          </span>
        </div>
      ))}
    </div>
  );
}

// ─── Health Card ────────────────────────────────────────────────────

function HealthCard({ agent, windowDays }: { agent: AgentHealth; windowDays: number }): React.ReactElement {
  const [expanded, setExpanded] = useState(false);
  const [diagReport, setDiagReport] = useState<DiagnosticReport | null>(null);
  const [diagLoading, setDiagLoading] = useState(false);
  const [diagError, setDiagError] = useState<string | null>(null);
  const [showDiag, setShowDiag] = useState(false);
  const trend = trendArrow(agent.trend);

  const handleDiagnose = useCallback(
    async (e: React.MouseEvent, refresh = false) => {
      e.stopPropagation();
      setShowDiag(true);
      setDiagLoading(true);
      setDiagError(null);
      try {
        const report = await diagnoseAgent(agent.agentId, windowDays, refresh);
        setDiagReport(report);
      } catch (err: any) {
        setDiagError(err?.message || 'Diagnosis failed');
      } finally {
        setDiagLoading(false);
      }
    },
    [agent.agentId, windowDays],
  );

  return (
    <div
      className={`rounded-xl border p-5 shadow-sm cursor-pointer transition-all duration-200 hover:shadow-md ${scoreBg(agent.overallScore)}`}
      onClick={() => setExpanded(!expanded)}
    >
      <div className="flex items-start justify-between">
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-semibold text-gray-900 truncate" title={agent.agentName || agent.agentId}>
            {agent.agentName || agent.agentId}
          </h3>
          <div className="flex items-center gap-2 mt-1">
            <span className={`text-sm font-medium ${trend.color}`}>
              {trend.icon} {trend.label}
            </span>
          </div>
        </div>
        <CircularGauge score={agent.overallScore} />
      </div>

      {/* Diagnose button for agents with score < 75 */}
      {agent.overallScore < 75 && !showDiag && (
        <button
          type="button"
          onClick={(e) => handleDiagnose(e)}
          className="mt-2 w-full text-xs font-medium text-purple-700 bg-purple-50 hover:bg-purple-100 border border-purple-200 rounded-lg px-3 py-1.5 transition-colors"
        >
          🧠 Diagnose with AI
        </button>
      )}

      {/* Diagnostic panel */}
      {showDiag && (
        <div className="mt-3" onClick={(e) => e.stopPropagation()}>
          <DiagnosticPanel
            report={diagReport}
            loading={diagLoading}
            error={diagError}
            onRefresh={() => handleDiagnose({ stopPropagation: () => {} } as React.MouseEvent, true)}
          />
        </div>
      )}

      {/* Expand indicator */}
      <div className="mt-2 text-xs text-gray-400 text-center">
        {expanded ? '▲ Collapse' : '▼ Click for details'}
      </div>

      {/* Expanded dimension breakdown */}
      {expanded && agent.dimensions && (
        <DimensionBreakdown dimensions={agent.dimensions} />
      )}
    </div>
  );
}

// ─── Main Component ─────────────────────────────────────────────────

type WindowSize = '1' | '7' | '14' | '30';

const WINDOW_OPTIONS: { value: WindowSize; label: string }[] = [
  { value: '1', label: '24h' },
  { value: '7', label: '7 days' },
  { value: '14', label: '14 days' },
  { value: '30', label: '30 days' },
];

export function HealthOverview(): React.ReactElement {
  const [window, setWindow] = useState<WindowSize>('7');

  const { data, loading, error } = useApi<HealthOverviewData>(
    () => getHealthOverview({ window: Number(window) }),
    [window],
  );

  // Summary stats
  const agents = data?.agents ?? [];
  const healthyCount = agents.filter((a) => a.overallScore >= 75).length;
  const warningCount = agents.filter((a) => a.overallScore >= 50 && a.overallScore < 75).length;
  const criticalCount = agents.filter((a) => a.overallScore < 50).length;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Health Overview</h1>
          <p className="text-sm text-gray-500 mt-1">
            Agent health scores and dimension breakdowns.
          </p>
        </div>
        <div className="flex gap-1 bg-gray-100 rounded-lg p-1">
          {WINDOW_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => setWindow(opt.value)}
              className={`px-3 py-1.5 text-sm rounded-md transition-colors ${
                window === opt.value
                  ? 'bg-white shadow-sm font-medium text-gray-900'
                  : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Summary Banner */}
      {!loading && !error && agents.length > 0 && (
        <div className="grid grid-cols-3 gap-4">
          <div className="rounded-lg border border-green-200 bg-green-50 px-4 py-3">
            <div className="flex items-center gap-2">
              <span className="text-lg">✅</span>
              <span className="text-xs font-medium text-gray-500 uppercase">Healthy</span>
            </div>
            <div className="mt-1 text-xl font-semibold text-green-700">{healthyCount}</div>
          </div>
          <div className="rounded-lg border border-yellow-200 bg-yellow-50 px-4 py-3">
            <div className="flex items-center gap-2">
              <span className="text-lg">⚠️</span>
              <span className="text-xs font-medium text-gray-500 uppercase">Warning</span>
            </div>
            <div className="mt-1 text-xl font-semibold text-yellow-700">{warningCount}</div>
          </div>
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3">
            <div className="flex items-center gap-2">
              <span className="text-lg">🔴</span>
              <span className="text-xs font-medium text-gray-500 uppercase">Critical</span>
            </div>
            <div className="mt-1 text-xl font-semibold text-red-700">{criticalCount}</div>
          </div>
        </div>
      )}

      {/* Content */}
      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <div key={i} className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
              <div className="animate-pulse space-y-3">
                <div className="h-4 bg-gray-200 rounded w-3/4" />
                <div className="h-16 bg-gray-100 rounded" />
              </div>
            </div>
          ))}
        </div>
      ) : error ? (
        <div className="rounded-xl border border-red-200 bg-red-50 p-8 text-center">
          <p className="text-red-600 font-medium">Failed to load health data</p>
          <p className="text-red-500 text-sm mt-1">{error}</p>
        </div>
      ) : agents.length === 0 ? (
        <div className="rounded-xl border border-gray-200 bg-white p-12 text-center">
          <span className="text-4xl">💚</span>
          <p className="text-gray-500 mt-3">No health data available yet.</p>
          <p className="text-gray-400 text-sm mt-1">
            Health scores are calculated once agents have enough activity.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {agents
            .sort((a, b) => a.overallScore - b.overallScore) // Worst first
            .map((agent) => (
              <HealthCard key={agent.agentId} agent={agent} windowDays={Number(window)} />
            ))}
        </div>
      )}
    </div>
  );
}
