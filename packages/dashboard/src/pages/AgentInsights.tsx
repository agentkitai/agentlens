/**
 * Agent Lifecycle Insights Dashboard (Phase 2 — Feature 7)
 *
 * Shows per-agent: tool call chains, delegation flows, health score drift.
 * Table: agent name, total sessions, avg score, tool usage, delegation count.
 * Click agent to see detail: recent sessions, tool usage distribution, health trend.
 *
 * Route: /agents/insights
 */

import React, { useState } from 'react';
import { useApi } from '../hooks/useApi';
import { getAgents } from '../api/agents';
import { getAgentInsights, type AgentInsightsData } from '../api/agent-insights';

// ─── Helpers ─────────────────────────────────────────────

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function topTools(usage: Record<string, number>, max = 3): string {
  return Object.entries(usage)
    .sort(([, a], [, b]) => b - a)
    .slice(0, max)
    .map(([name, count]) => `${name} (${count})`)
    .join(', ') || 'None';
}

// ─── Agent Detail Panel ──────────────────────────────────

function AgentDetailPanel({
  data,
  onClose,
}: {
  data: AgentInsightsData;
  onClose: () => void;
}): React.ReactElement {
  const toolEntries = Object.entries(data.toolUsage).sort(([, a], [, b]) => b - a);
  const totalToolCalls = toolEntries.reduce((sum, [, count]) => sum + count, 0);

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-6 space-y-5">
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">{data.agent.name}</h2>
          {data.agent.description && (
            <p className="text-sm text-gray-500">{data.agent.description}</p>
          )}
        </div>
        <button
          onClick={onClose}
          className="rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50"
        >
          Close
        </button>
      </div>

      {/* Summary stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="rounded-lg bg-gray-50 p-3">
          <p className="text-xs text-gray-500 mb-1">Total Sessions</p>
          <p className="text-lg font-semibold text-gray-900">{data.totalSessions}</p>
        </div>
        <div className="rounded-lg bg-gray-50 p-3">
          <p className="text-xs text-gray-500 mb-1">Avg Score</p>
          <p className="text-lg font-semibold text-gray-900">
            {data.avgScore != null ? data.avgScore : '--'}
          </p>
        </div>
        <div className="rounded-lg bg-gray-50 p-3">
          <p className="text-xs text-gray-500 mb-1">Tool Calls</p>
          <p className="text-lg font-semibold text-gray-900">{totalToolCalls}</p>
        </div>
        <div className="rounded-lg bg-gray-50 p-3">
          <p className="text-xs text-gray-500 mb-1">Delegations</p>
          <p className="text-lg font-semibold text-gray-900">{data.delegationCount}</p>
        </div>
      </div>

      {/* Tool Usage Distribution */}
      <div>
        <h3 className="text-sm font-semibold text-gray-700 mb-2">Tool Usage Distribution</h3>
        {toolEntries.length === 0 ? (
          <p className="text-sm text-gray-400">No tool calls recorded</p>
        ) : (
          <div className="space-y-2">
            {toolEntries.slice(0, 10).map(([name, count]) => {
              const pct = totalToolCalls > 0 ? Math.round((count / totalToolCalls) * 100) : 0;
              return (
                <div key={name} className="flex items-center gap-3">
                  <span className="w-32 text-xs text-gray-600 truncate" title={name}>{name}</span>
                  <div className="flex-1 h-4 rounded bg-gray-100 overflow-hidden">
                    <div
                      className="h-full rounded bg-blue-500"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <span className="text-xs text-gray-500 w-16 text-right">{count} ({pct}%)</span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Health Trend */}
      {data.healthTrend.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-gray-700 mb-2">Health Score Trend</h3>
          <div className="flex items-end gap-1 h-20">
            {data.healthTrend.map((point, idx) => {
              const score = point.score ?? 0;
              const height = Math.max(4, (score / 100) * 80);
              const color = score >= 70 ? 'bg-green-400' : score >= 40 ? 'bg-yellow-400' : 'bg-red-400';
              return (
                <div
                  key={idx}
                  className={`flex-1 rounded-t ${color}`}
                  style={{ height: `${height}px` }}
                  title={`Session ${point.sessionId}: ${score}`}
                />
              );
            })}
          </div>
          <div className="flex justify-between text-xs text-gray-400 mt-1">
            <span>Oldest</span>
            <span>Latest</span>
          </div>
        </div>
      )}

      {/* Recent Sessions */}
      <div>
        <h3 className="text-sm font-semibold text-gray-700 mb-2">Recent Sessions</h3>
        <table className="w-full">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              <th className="px-3 py-2 text-left text-xs font-medium uppercase text-gray-500">Session</th>
              <th className="px-3 py-2 text-left text-xs font-medium uppercase text-gray-500">Started</th>
              <th className="px-3 py-2 text-left text-xs font-medium uppercase text-gray-500">Events</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {data.recentSessions.map((s) => (
              <tr key={s.id} className="hover:bg-gray-50">
                <td className="px-3 py-2 text-sm font-mono text-gray-700 truncate max-w-[200px]">{s.id}</td>
                <td className="px-3 py-2 text-sm text-gray-500">{timeAgo(s.startedAt)}</td>
                <td className="px-3 py-2 text-sm text-gray-500">{s.eventCount}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Main Component ──────────────────────────────────────

export function AgentInsights(): React.ReactElement {
  const [selectedAgent, setSelectedAgent] = useState<string | null>(null);

  const agentsQuery = useApi(() => getAgents(), []);
  const agents = agentsQuery.data ?? [];

  const insightsQuery = useApi(
    () => (selectedAgent ? getAgentInsights(selectedAgent) : Promise.resolve(null)),
    [selectedAgent],
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Agent Insights</h1>
        <p className="text-sm text-gray-500 mt-1">
          Per-agent lifecycle metrics: tool usage, delegations, health trends
        </p>
      </div>

      {/* Detail panel */}
      {selectedAgent && insightsQuery.data && (
        <AgentDetailPanel
          data={insightsQuery.data}
          onClose={() => setSelectedAgent(null)}
        />
      )}
      {selectedAgent && insightsQuery.loading && (
        <div className="rounded-lg border border-gray-200 bg-white p-8 text-center text-sm text-gray-500">
          Loading insights...
        </div>
      )}
      {selectedAgent && insightsQuery.error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {insightsQuery.error}
        </div>
      )}

      {/* Agents table */}
      {agentsQuery.loading && (
        <div className="py-12 text-center text-sm text-gray-500">Loading agents...</div>
      )}

      {!agentsQuery.loading && agents.length === 0 && (
        <div className="rounded-lg border border-gray-200 bg-white py-12 text-center">
          <p className="text-gray-500">No agents found</p>
          <p className="mt-1 text-sm text-gray-400">
            Agents appear here once they start sending telemetry
          </p>
        </div>
      )}

      {!agentsQuery.loading && agents.length > 0 && (
        <div className="rounded-lg border border-gray-200 bg-white overflow-hidden">
          <table className="w-full">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">Agent</th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">Sessions</th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">Last Seen</th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {agents.map((agent) => (
                <tr
                  key={agent.name}
                  className={`hover:bg-gray-50 cursor-pointer ${
                    selectedAgent === agent.name ? 'bg-blue-50' : ''
                  }`}
                  onClick={() =>
                    setSelectedAgent(selectedAgent === agent.name ? null : agent.name)
                  }
                >
                  <td className="px-4 py-3">
                    <div className="text-sm font-medium text-gray-900">{agent.name}</div>
                    {agent.description && (
                      <div className="text-xs text-gray-500 truncate max-w-[300px]">{agent.description}</div>
                    )}
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-600">{agent.sessionCount}</td>
                  <td className="px-4 py-3 text-sm text-gray-500">{timeAgo(agent.lastSeenAt)}</td>
                  <td className="px-4 py-3">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedAgent(agent.name);
                      }}
                      className="rounded-md bg-blue-50 px-3 py-1 text-xs font-medium text-blue-700 hover:bg-blue-100"
                    >
                      View Insights
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default AgentInsights;
