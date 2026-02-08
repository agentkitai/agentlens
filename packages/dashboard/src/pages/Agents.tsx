/**
 * Agents Page (Story 8.2)
 *
 * Route: /agents
 * - Agent cards: name, last seen, session count, error rate
 * - Click card → navigate to /sessions?agentId=xxx
 * - Sorted by last seen (most recent first)
 * - Tailwind grid layout
 */

import React from 'react';
import { useNavigate } from 'react-router-dom';
import type { Agent } from '@agentlensai/core';
import { getAgents } from '../api/client';
import { useApi } from '../hooks/useApi';

// ─── Helpers ────────────────────────────────────────────────

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  return `${months}mo ago`;
}

function getInitials(name: string): string {
  return name
    .split(/[\s_-]+/)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .slice(0, 2)
    .join('');
}

const AGENT_COLORS = [
  'from-indigo-500 to-purple-500',
  'from-emerald-500 to-teal-500',
  'from-amber-500 to-orange-500',
  'from-pink-500 to-rose-500',
  'from-sky-500 to-blue-500',
  'from-violet-500 to-fuchsia-500',
];

function colorForAgent(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = (hash * 31 + id.charCodeAt(i)) | 0;
  }
  return AGENT_COLORS[Math.abs(hash) % AGENT_COLORS.length] ?? AGENT_COLORS[0];
}

// ─── Agent Card ─────────────────────────────────────────────

/** Agent with computed error rate from server */
interface AgentWithErrorRate extends Agent {
  errorRate?: number;
}

interface AgentCardProps {
  agent: AgentWithErrorRate;
  onClick: () => void;
}

function AgentCard({ agent, onClick }: AgentCardProps): React.ReactElement {
  const errorRate = agent.errorRate ?? 0;
  const errorRatePercent = (errorRate * 100).toFixed(1);
  const errorRateColor =
    errorRate >= 0.1 ? 'text-red-600' : errorRate >= 0.05 ? 'text-yellow-600' : 'text-green-600';

  return (
    <button
      type="button"
      onClick={onClick}
      className="flex flex-col rounded-lg border border-gray-200 bg-white p-5 text-left shadow-sm transition hover:border-indigo-300 hover:shadow-md"
    >
      <div className="flex items-center gap-3">
        <div
          className={`flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-br text-sm font-bold text-white ${colorForAgent(agent.id)}`}
        >
          {getInitials(agent.name)}
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-sm font-semibold text-gray-900">{agent.name}</h3>
          {agent.description && (
            <p className="truncate text-xs text-gray-500">{agent.description}</p>
          )}
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2 border-t border-gray-100 pt-3 sm:grid-cols-4">
        <div>
          <p className="text-xs text-gray-500">Sessions</p>
          <p className="text-sm font-semibold text-gray-900">
            {agent.sessionCount.toLocaleString()}
          </p>
        </div>
        <div>
          <p className="text-xs text-gray-500">Error Rate</p>
          <p className={`text-sm font-semibold ${errorRateColor}`}>
            {errorRatePercent}%
          </p>
        </div>
        <div>
          <p className="text-xs text-gray-500">Last Seen</p>
          <p className="text-sm font-semibold text-gray-900">
            {timeAgo(agent.lastSeenAt)}
          </p>
        </div>
        <div>
          <p className="text-xs text-gray-500">First Seen</p>
          <p className="text-sm font-semibold text-gray-900">
            {timeAgo(agent.firstSeenAt)}
          </p>
        </div>
      </div>
    </button>
  );
}

// ─── Main Component ─────────────────────────────────────────

export function Agents(): React.ReactElement {
  const navigate = useNavigate();
  const { data: agents, loading, error } = useApi(() => getAgents() as Promise<AgentWithErrorRate[]>, []);

  const sorted = (agents ?? []).slice().sort(
    (a, b) => new Date(b.lastSeenAt).getTime() - new Date(a.lastSeenAt).getTime(),
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Agents</h1>
        {sorted.length > 0 && (
          <span className="text-sm text-gray-500">
            {sorted.length} agent{sorted.length !== 1 ? 's' : ''}
          </span>
        )}
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {loading && !agents && (
        <div className="py-12 text-center text-sm text-gray-500">Loading agents…</div>
      )}

      {agents && sorted.length === 0 && (
        <div className="rounded-lg border border-gray-200 bg-white py-12 text-center">
          <p className="text-gray-500">No agents found</p>
          <p className="mt-1 text-sm text-gray-400">
            Agents will appear here when they start sending events
          </p>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {sorted.map((agent) => (
          <AgentCard
            key={agent.id}
            agent={agent}
            onClick={() => navigate(`/sessions?agentId=${encodeURIComponent(agent.id)}`)}
          />
        ))}
      </div>
    </div>
  );
}
