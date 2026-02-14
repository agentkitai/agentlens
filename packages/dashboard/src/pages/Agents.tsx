/**
 * Unified Agents Page
 *
 * Single page for agent management. Source of truth: Mesh backend (/api/mesh/agents).
 * Combines registry CRUD, agent details, and capability discovery.
 *
 * Route: /agents
 */

import React, { useState, useCallback, useMemo } from 'react';
import { useApi } from '../hooks/useApi';
import {
  getMeshAgents,
  registerMeshAgent,
  unregisterMeshAgent,
  discoverAgents,
  type MeshAgent,
} from '../api/discovery';
import { getAgents } from '../api/agents';
import type { Agent as TelemetryAgent } from '../api/core';

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

function colorForAgent(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = (hash * 31 + name.charCodeAt(i)) | 0;
  }
  return AGENT_COLORS[Math.abs(hash) % AGENT_COLORS.length] ?? AGENT_COLORS[0];
}

function statusDot(lastSeen: string): { color: string; label: string } {
  const diff = Date.now() - new Date(lastSeen).getTime();
  const minutes = diff / 60_000;
  if (minutes < 5) return { color: 'bg-green-500', label: 'Online' };
  if (minutes < 60) return { color: 'bg-yellow-500', label: 'Idle' };
  return { color: 'bg-gray-400', label: 'Offline' };
}

// ─── Agent Card ─────────────────────────────────────────────

function AgentCard({
  agent,
  telemetry,
  onSelect,
  selected,
  onUnregister,
}: {
  agent: MeshAgent;
  telemetry?: TelemetryAgent;
  onSelect: () => void;
  selected: boolean;
  onUnregister: () => void;
}): React.ReactElement {
  const status = statusDot(agent.last_seen);

  return (
    <button
      type="button"
      onClick={onSelect}
      className={`flex flex-col rounded-lg border bg-white p-5 text-left shadow-sm transition hover:shadow-md ${
        selected ? 'border-blue-400 ring-2 ring-blue-100' : 'border-gray-200 hover:border-indigo-300'
      }`}
    >
      <div className="flex items-center gap-3">
        <div
          className={`flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-br text-sm font-bold text-white ${colorForAgent(agent.name)}`}
        >
          {getInitials(agent.name)}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="truncate text-sm font-semibold text-gray-900">{agent.name}</h3>
            <span className={`h-2 w-2 rounded-full ${status.color}`} title={status.label} />
          </div>
          {agent.description && (
            <p className="truncate text-xs text-gray-500">{agent.description}</p>
          )}
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-1.5">
        {agent.capabilities.map((cap) => (
          <span
            key={cap}
            className="inline-flex items-center rounded-full bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700"
          >
            {cap}
          </span>
        ))}
      </div>

      {/* Telemetry stats (if available) */}
      {telemetry && (
        <div className="mt-3 flex flex-wrap gap-3 border-t border-gray-100 pt-3">
          <span className="text-xs text-gray-500">
            <span className="font-medium text-gray-700">{telemetry.sessionCount}</span> sessions
          </span>
          {telemetry.pausedAt && (
            <span className="text-xs text-red-500 font-medium">⏸ Paused</span>
          )}
          {telemetry.modelOverride && (
            <span className="text-xs text-amber-600">Model: {telemetry.modelOverride}</span>
          )}
        </div>
      )}

      <div className={`mt-3 flex items-center justify-between ${!telemetry ? 'border-t border-gray-100 pt-3' : ''} text-xs text-gray-400`}>
        <span>{agent.protocol}</span>
        <span>{timeAgo(agent.last_seen)}</span>
      </div>
    </button>
  );
}

// ─── Agent Detail Panel ─────────────────────────────────────

function AgentDetail({
  agent,
  telemetry,
  onClose,
  onUnregister,
}: {
  agent: MeshAgent;
  telemetry?: TelemetryAgent;
  onClose: () => void;
  onUnregister: () => void;
}): React.ReactElement {
  const status = statusDot(agent.last_seen);

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-6 space-y-5">
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <div
            className={`flex h-12 w-12 items-center justify-center rounded-full bg-gradient-to-br text-base font-bold text-white ${colorForAgent(agent.name)}`}
          >
            {getInitials(agent.name)}
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-semibold text-gray-900">{agent.name}</h2>
              <span
                className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${
                  status.label === 'Online'
                    ? 'bg-green-50 text-green-700'
                    : status.label === 'Idle'
                      ? 'bg-yellow-50 text-yellow-700'
                      : 'bg-gray-100 text-gray-600'
                }`}
              >
                <span className={`h-1.5 w-1.5 rounded-full ${status.color}`} />
                {status.label}
              </span>
            </div>
            <p className="text-sm text-gray-500">{agent.description}</p>
          </div>
        </div>
        <div className="flex gap-2">
          <button
            onClick={onUnregister}
            className="rounded-md border border-red-200 px-3 py-1.5 text-sm text-red-600 hover:bg-red-50"
          >
            Unregister
          </button>
          <button
            onClick={onClose}
            className="rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50"
          >
            Close
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="rounded-lg bg-gray-50 p-3">
          <p className="text-xs text-gray-500 mb-1">Endpoint</p>
          <p className="text-sm font-mono text-gray-900 break-all">{agent.endpoint}</p>
        </div>
        <div className="rounded-lg bg-gray-50 p-3">
          <p className="text-xs text-gray-500 mb-1">Protocol</p>
          <p className="text-sm text-gray-900">{agent.protocol}</p>
        </div>
        <div className="rounded-lg bg-gray-50 p-3">
          <p className="text-xs text-gray-500 mb-1">Registered</p>
          <p className="text-sm text-gray-900">{new Date(agent.registered_at).toLocaleString()}</p>
        </div>
        {telemetry && (
          <>
            <div className="rounded-lg bg-gray-50 p-3">
              <p className="text-xs text-gray-500 mb-1">Sessions</p>
              <p className="text-sm font-semibold text-gray-900">{telemetry.sessionCount}</p>
            </div>
            <div className="rounded-lg bg-gray-50 p-3">
              <p className="text-xs text-gray-500 mb-1">First Seen</p>
              <p className="text-sm text-gray-900">{new Date(telemetry.firstSeenAt).toLocaleString()}</p>
            </div>
            {telemetry.pausedAt && (
              <div className="rounded-lg bg-red-50 p-3">
                <p className="text-xs text-red-500 mb-1">Paused</p>
                <p className="text-sm text-red-700">{telemetry.pauseReason ?? 'By guardrail'}</p>
              </div>
            )}
          </>
        )}
      </div>

      <div>
        <p className="text-xs text-gray-500 mb-2">Capabilities</p>
        <div className="flex flex-wrap gap-2">
          {agent.capabilities.map((cap) => (
            <span
              key={cap}
              className="inline-flex items-center rounded-full bg-blue-50 px-3 py-1 text-sm font-medium text-blue-700"
            >
              {cap}
            </span>
          ))}
          {agent.capabilities.length === 0 && (
            <span className="text-sm text-gray-400">No capabilities listed</span>
          )}
        </div>
      </div>

      <div className="text-xs text-gray-400">
        Last seen: {new Date(agent.last_seen).toLocaleString()}
      </div>
    </div>
  );
}

// ─── Register Form ──────────────────────────────────────────

function RegisterForm({
  onSubmit,
  onCancel,
}: {
  onSubmit: (data: {
    name: string;
    description: string;
    capabilities: string[];
    endpoint: string;
  }) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [capabilities, setCapabilities] = useState('');
  const [endpoint, setEndpoint] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit({
      name,
      description,
      capabilities: capabilities
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
      endpoint,
    });
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="rounded-lg border border-gray-200 bg-gray-50 p-4 space-y-3"
    >
      <h3 className="text-sm font-semibold text-gray-900">Register New Agent</h3>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <label className="block text-sm text-gray-700">
          Name
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            required
          />
        </label>
        <label className="block text-sm text-gray-700">
          Endpoint
          <input
            value={endpoint}
            onChange={(e) => setEndpoint(e.target.value)}
            className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            required
          />
        </label>
        <label className="block text-sm text-gray-700">
          Description
          <input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </label>
        <label className="block text-sm text-gray-700">
          Capabilities (comma-separated)
          <input
            value={capabilities}
            onChange={(e) => setCapabilities(e.target.value)}
            className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </label>
      </div>
      <div className="flex gap-2">
        <button
          type="submit"
          className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
        >
          Register
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

// ─── Main Component ─────────────────────────────────────────

export function Agents(): React.ReactElement {
  const [search, setSearch] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [selectedAgent, setSelectedAgent] = useState<string | null>(null);
  const [discoveryQuery, setDiscoveryQuery] = useState('');
  const [discoveryResults, setDiscoveryResults] = useState<
    { agent: MeshAgent; score: number; matchedTerms: string[] }[] | null
  >(null);

  const agentsQuery = useApi(() => getMeshAgents(), []);
  const agents = agentsQuery.data ?? [];

  // Fetch telemetry data (observability) — optional enrichment
  const telemetryQuery = useApi(() => getAgents(), []);
  const telemetryMap = useMemo(() => {
    const map = new Map<string, TelemetryAgent>();
    for (const t of telemetryQuery.data ?? []) {
      map.set(t.name.toLowerCase(), t);
    }
    return map;
  }, [telemetryQuery.data]);

  // Filter agents by search
  const filtered = (discoveryResults ? discoveryResults.map((r) => r.agent) : agents).filter(
    (a) =>
      !search ||
      a.name.toLowerCase().includes(search.toLowerCase()) ||
      a.description.toLowerCase().includes(search.toLowerCase()) ||
      a.capabilities.some((c) => c.toLowerCase().includes(search.toLowerCase())),
  );

  const selected = agents.find((a) => a.name === selectedAgent) ?? null;

  const handleUnregister = useCallback(
    async (name: string) => {
      if (!confirm(`Unregister agent "${name}"?`)) return;
      await unregisterMeshAgent(name);
      if (selectedAgent === name) setSelectedAgent(null);
      agentsQuery.refetch();
    },
    [agentsQuery, selectedAgent],
  );

  const handleRegister = useCallback(
    async (data: {
      name: string;
      description: string;
      capabilities: string[];
      endpoint: string;
    }) => {
      await registerMeshAgent(data);
      setShowForm(false);
      agentsQuery.refetch();
    },
    [agentsQuery],
  );

  const handleDiscover = async () => {
    if (!discoveryQuery.trim()) {
      setDiscoveryResults(null);
      return;
    }
    const results = await discoverAgents(discoveryQuery.trim());
    setDiscoveryResults(results);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Agents</h1>
          <p className="text-sm text-gray-500 mt-1">
            Manage registered agents, capabilities, and discovery
          </p>
        </div>
        <button
          onClick={() => setShowForm(!showForm)}
          className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
        >
          {showForm ? 'Cancel' : '+ Register Agent'}
        </button>
      </div>

      {/* Register Form */}
      {showForm && (
        <RegisterForm onSubmit={handleRegister} onCancel={() => setShowForm(false)} />
      )}

      {/* Search & Discovery */}
      <div className="rounded-lg border border-gray-200 bg-white p-4 space-y-3">
        <div className="flex flex-col md:flex-row gap-3">
          <input
            type="text"
            placeholder="Filter agents..."
            className="flex-1 rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            data-testid="search-input"
          />
          <div className="flex gap-2">
            <input
              type="text"
              placeholder="Discover by capability..."
              className="rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              value={discoveryQuery}
              onChange={(e) => setDiscoveryQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleDiscover()}
            />
            <button
              onClick={handleDiscover}
              className="rounded-md bg-gray-100 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-200"
            >
              🔍
            </button>
            {discoveryResults && (
              <button
                onClick={() => {
                  setDiscoveryResults(null);
                  setDiscoveryQuery('');
                }}
                className="rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-600 hover:bg-gray-50"
              >
                Clear
              </button>
            )}
          </div>
        </div>
        {discoveryResults && (
          <p className="text-xs text-gray-500">
            {discoveryResults.length} result(s) for &quot;{discoveryQuery}&quot;
          </p>
        )}
      </div>

      {/* Loading / Error */}
      {agentsQuery.loading && (
        <div className="py-12 text-center text-sm text-gray-500">Loading agents…</div>
      )}
      {agentsQuery.error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {agentsQuery.error}
        </div>
      )}

      {/* Selected Agent Detail */}
      {selected && (
        <AgentDetail
          agent={selected}
          telemetry={telemetryMap.get(selected.name.toLowerCase())}
          onClose={() => setSelectedAgent(null)}
          onUnregister={() => handleUnregister(selected.name)}
        />
      )}

      {/* Agent Grid */}
      {!agentsQuery.loading && filtered.length === 0 && (
        <div className="rounded-lg border border-gray-200 bg-white py-12 text-center">
          <div className="text-4xl mb-3">🤖</div>
          <p className="text-gray-500">No agents found</p>
          <p className="mt-1 text-sm text-gray-400">
            Register agents to see them here
          </p>
        </div>
      )}

      {filtered.length > 0 && (
        <>
          <div className="text-sm text-gray-500">
            {filtered.length} agent{filtered.length !== 1 ? 's' : ''}
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {filtered.map((agent) => (
              <AgentCard
                key={agent.name}
                agent={agent}
                telemetry={telemetryMap.get(agent.name.toLowerCase())}
                selected={selectedAgent === agent.name}
                onSelect={() =>
                  setSelectedAgent(selectedAgent === agent.name ? null : agent.name)
                }
                onUnregister={() => handleUnregister(agent.name)}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
