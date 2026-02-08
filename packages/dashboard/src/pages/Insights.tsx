import React, { useState, useCallback } from 'react';
import { useApi } from '../hooks/useApi';
import {
  reflect,
  getAgents,
  type ReflectAnalysis,
  type ReflectResultData,
} from '../api/client';

type Tab = 'error_patterns' | 'tool_sequences' | 'cost_analysis' | 'performance_trends';

const TABS: { key: Tab; label: string; icon: string }[] = [
  { key: 'error_patterns', label: 'Error Patterns', icon: '🔴' },
  { key: 'tool_sequences', label: 'Tool Sequences', icon: '🔗' },
  { key: 'cost_analysis', label: 'Cost Analysis', icon: '💰' },
  { key: 'performance_trends', label: 'Performance', icon: '📈' },
];

function formatTimestamp(ts?: string): string {
  if (!ts) return '—';
  try {
    return new Date(ts).toLocaleDateString();
  } catch {
    return ts;
  }
}

// ─── Error Patterns ─────────────────────────────────────

function ErrorPatternsView({ data }: { data: ReflectResultData }): React.ReactElement {
  const patterns = data.insights;
  if (patterns.length === 0) {
    return <div className="py-8 text-center text-gray-500">No error patterns found.</div>;
  }
  return (
    <table className="w-full">
      <thead className="bg-gray-50 border-b border-gray-200">
        <tr>
          <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">Pattern</th>
          <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">Count</th>
          <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">First Seen</th>
          <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">Last Seen</th>
          <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">Confidence</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-gray-200">
        {patterns.map((insight, idx) => (
          <tr key={idx} className="hover:bg-gray-50">
            <td className="px-4 py-3 text-sm text-gray-900">{insight.summary}</td>
            <td className="px-4 py-3 text-sm text-gray-600">{(insight.data.count as number) ?? '—'}</td>
            <td className="px-4 py-3 text-sm text-gray-600">{formatTimestamp(insight.data.firstSeen as string)}</td>
            <td className="px-4 py-3 text-sm text-gray-600">{formatTimestamp(insight.data.lastSeen as string)}</td>
            <td className="px-4 py-3 text-sm text-gray-600">{(insight.confidence * 100).toFixed(0)}%</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ─── Tool Sequences ─────────────────────────────────────

function ToolSequencesView({ data }: { data: ReflectResultData }): React.ReactElement {
  const sequences = data.insights;
  if (sequences.length === 0) {
    return <div className="py-8 text-center text-gray-500">No tool sequences found.</div>;
  }
  return (
    <table className="w-full">
      <thead className="bg-gray-50 border-b border-gray-200">
        <tr>
          <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">Sequence</th>
          <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">Frequency</th>
          <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">Error Rate</th>
          <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">Confidence</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-gray-200">
        {sequences.map((insight, idx) => (
          <tr key={idx} className="hover:bg-gray-50">
            <td className="px-4 py-3 text-sm text-gray-900 font-mono">{insight.summary}</td>
            <td className="px-4 py-3 text-sm text-gray-600">{(insight.data.frequency as number) ?? '—'}</td>
            <td className="px-4 py-3 text-sm text-gray-600">
              {insight.data.errorRate != null ? `${((insight.data.errorRate as number) * 100).toFixed(1)}%` : '—'}
            </td>
            <td className="px-4 py-3 text-sm text-gray-600">{(insight.confidence * 100).toFixed(0)}%</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ─── Cost Analysis ──────────────────────────────────────

function CostAnalysisView({ data }: { data: ReflectResultData }): React.ReactElement {
  const insights = data.insights;
  // Find summary insight
  const summaryInsight = insights.find((i) => i.type === 'cost_summary' || i.type === 'summary');
  const modelInsights = insights.filter((i) => i.type === 'cost_by_model' || i.type === 'model_breakdown');

  return (
    <div className="space-y-6">
      {/* Summary Cards */}
      {summaryInsight && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="rounded-lg border border-gray-200 bg-white p-4">
            <div className="text-sm text-gray-500">Total Cost</div>
            <div className="text-2xl font-bold text-gray-900">
              ${((summaryInsight.data.totalCost as number) ?? 0).toFixed(2)}
            </div>
          </div>
          <div className="rounded-lg border border-gray-200 bg-white p-4">
            <div className="text-sm text-gray-500">Avg / Session</div>
            <div className="text-2xl font-bold text-gray-900">
              ${((summaryInsight.data.avgPerSession as number) ?? 0).toFixed(4)}
            </div>
          </div>
          <div className="rounded-lg border border-gray-200 bg-white p-4">
            <div className="text-sm text-gray-500">Sessions</div>
            <div className="text-2xl font-bold text-gray-900">
              {(summaryInsight.data.totalSessions as number) ?? 0}
            </div>
          </div>
        </div>
      )}

      {/* Model Breakdown or All Insights */}
      {insights.length > 0 && (
        <table className="w-full">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">Insight</th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">Type</th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">Confidence</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {insights.map((insight, idx) => (
              <tr key={idx} className="hover:bg-gray-50">
                <td className="px-4 py-3 text-sm text-gray-900">{insight.summary}</td>
                <td className="px-4 py-3 text-sm text-gray-600">{insight.type}</td>
                <td className="px-4 py-3 text-sm text-gray-600">{(insight.confidence * 100).toFixed(0)}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {insights.length === 0 && (
        <div className="py-8 text-center text-gray-500">No cost analysis data available.</div>
      )}
    </div>
  );
}

// ─── Performance Trends ─────────────────────────────────

function PerformanceView({ data }: { data: ReflectResultData }): React.ReactElement {
  const insights = data.insights;
  // Find summary/current insight
  const summaryInsight = insights.find((i) => i.type === 'performance_summary' || i.type === 'current');

  return (
    <div className="space-y-6">
      {/* Summary Cards */}
      {summaryInsight && (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div className="rounded-lg border border-gray-200 bg-white p-4">
            <div className="text-sm text-gray-500">Success Rate</div>
            <div className="text-2xl font-bold text-gray-900">
              {(((summaryInsight.data.successRate as number) ?? 0) * 100).toFixed(1)}%
            </div>
          </div>
          <div className="rounded-lg border border-gray-200 bg-white p-4">
            <div className="text-sm text-gray-500">Avg Duration</div>
            <div className="text-2xl font-bold text-gray-900">
              {((summaryInsight.data.avgDuration as number) ?? 0).toFixed(0)}ms
            </div>
          </div>
          <div className="rounded-lg border border-gray-200 bg-white p-4">
            <div className="text-sm text-gray-500">Avg Tool Calls</div>
            <div className="text-2xl font-bold text-gray-900">
              {((summaryInsight.data.avgToolCalls as number) ?? 0).toFixed(1)}
            </div>
          </div>
          <div className="rounded-lg border border-gray-200 bg-white p-4">
            <div className="text-sm text-gray-500">Assessment</div>
            <div className="text-2xl font-bold text-gray-900">
              {(summaryInsight.data.assessment as string) ?? '—'}
            </div>
          </div>
        </div>
      )}

      {/* All Insights */}
      {insights.length > 0 ? (
        <table className="w-full">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">Insight</th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">Type</th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">Confidence</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {insights.map((insight, idx) => (
              <tr key={idx} className="hover:bg-gray-50">
                <td className="px-4 py-3 text-sm text-gray-900">{insight.summary}</td>
                <td className="px-4 py-3 text-sm text-gray-600">{insight.type}</td>
                <td className="px-4 py-3 text-sm text-gray-600">{(insight.confidence * 100).toFixed(0)}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <div className="py-8 text-center text-gray-500">No performance data available.</div>
      )}
    </div>
  );
}

// ─── Main Component ─────────────────────────────────────

export function Insights(): React.ReactElement {
  const [tab, setTab] = useState<Tab>('error_patterns');
  const [agentFilter, setAgentFilter] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const agents = useApi(() => getAgents(), []);

  const result = useApi(
    () =>
      reflect({
        analysis: tab as ReflectAnalysis,
        agentId: agentFilter || undefined,
        from: from || undefined,
        to: to || undefined,
      }),
    [tab, agentFilter, from, to],
  );

  const renderContent = useCallback(() => {
    if (result.loading) {
      return <div className="py-12 text-center text-gray-500">Analyzing...</div>;
    }
    if (result.error) {
      return <div className="py-12 text-center text-red-500">Error: {result.error}</div>;
    }
    if (!result.data) {
      return <div className="py-12 text-center text-gray-500">No data</div>;
    }

    switch (tab) {
      case 'error_patterns':
        return <ErrorPatternsView data={result.data} />;
      case 'tool_sequences':
        return <ToolSequencesView data={result.data} />;
      case 'cost_analysis':
        return <CostAnalysisView data={result.data} />;
      case 'performance_trends':
        return <PerformanceView data={result.data} />;
    }
  }, [tab, result]);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-gray-900">Insights</h1>

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <select
          className="rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          value={agentFilter}
          onChange={(e) => setAgentFilter(e.target.value)}
        >
          <option value="">All Agents</option>
          {(agents.data ?? []).map((agent) => (
            <option key={agent.id} value={agent.id}>
              {agent.name || agent.id}
            </option>
          ))}
        </select>
        <input
          type="date"
          className="rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          value={from}
          onChange={(e) => setFrom(e.target.value)}
        />
        <input
          type="date"
          className="rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          value={to}
          onChange={(e) => setTo(e.target.value)}
        />
      </div>

      {/* Tabs */}
      <div className="border-b border-gray-200">
        <nav className="-mb-px flex gap-6">
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`pb-3 text-sm font-medium border-b-2 transition-colors flex items-center gap-1.5 ${
                tab === t.key
                  ? 'border-blue-600 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              <span>{t.icon}</span>
              {t.label}
            </button>
          ))}
        </nav>
      </div>

      {/* Metadata */}
      {result.data?.metadata && (
        <div className="text-xs text-gray-400">
          Analyzed {result.data.metadata.sessionsAnalyzed} sessions,{' '}
          {result.data.metadata.eventsAnalyzed} events
          {result.data.metadata.timeRange && (
            <> ({formatTimestamp(result.data.metadata.timeRange.from)} – {formatTimestamp(result.data.metadata.timeRange.to)})</>
          )}
        </div>
      )}

      {/* Content */}
      <div className="rounded-lg border border-gray-200 bg-white overflow-hidden">
        {renderContent()}
      </div>
    </div>
  );
}
