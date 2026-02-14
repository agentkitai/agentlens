/**
 * Unified Agents Page
 *
 * Merges:
 * - Observability agents (sessions/error rates)
 * - Mesh Agent Registry (register/unregister)
 * - Agent Network discovery (search by capability)
 *
 * Route: /agents
 */

import React, { useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Agent } from '@agentlensai/core';
import { getAgents } from '../api/client';
import { useApi } from '../hooks/useApi';
import { useFeatures } from '../hooks/useFeatures';
import {
  getMeshAgents,
  registerMeshAgent,
  unregisterMeshAgent,
  discoverAgents,
  type MeshAgent,
} from '../api/discovery';

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

// ─── Tab type ───────────────────────────────────────────────

type Tab = 'overview' | 'registry' | 'network';

// ─── Observability Agent Card ───────────────────────────────

interface AgentWithErrorRate extends Agent {
  errorRate?: number;
}

function AgentCard({
  agent,
  onClick,
}: {
  agent: AgentWithErrorRate;
  onClick: () => void;
}): React.ReactElement {
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
          <p className={`text-sm font-semibold ${errorRateColor}`}>{errorRatePercent}%</p>
        </div>
        <div>
          <p className="text-xs text-gray-500">Last Seen</p>
          <p className="text-sm font-semibold text-gray-900">{timeAgo(agent.lastSeenAt)}</p>
        </div>
        <div>
          <p className="text-xs text-gray-500">First Seen</p>
          <p className="text-sm font-semibold text-gray-900">{timeAgo(agent.firstSeenAt)}</p>
        </div>
      </div>
    </button>
  );
}

// ─── Mesh Register Form ─────────────────────────────────────

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

// ─── Registry Tab ───────────────────────────────────────────

function RegistryTab(): React.ReactElement {
  const [showForm, setShowForm] = useState(false);
  const [search, setSearch] = useState('');
  const agentsQuery = useApi(() => getMeshAgents(), []);
  const agents = agentsQuery.data ?? [];

  const filtered = agents.filter(
    (a) =>
      !search ||
      a.name.toLowerCase().includes(search.toLowerCase()) ||
      a.description.toLowerCase().includes(search.toLowerCase()) ||
      a.capabilities.some((c) => c.toLowerCase().includes(search.toLowerCase())),
  );

  const handleUnregister = useCallback(
    async (name: string) => {
      if (!confirm(`Unregister agent "${name}"?`)) return;
      await unregisterMeshAgent(name);
      agentsQuery.refetch();
    },
    [agentsQuery],
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

  return (
    <div className="space-y-4">
      <div className="flex flex-col md:flex-row gap-3">
        <input
          type="text"
          placeholder="Filter agents by name, description, or capability..."
          className="flex-1 rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <button
          onClick={() => setShowForm(!showForm)}
          className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
        >
          {showForm ? 'Cancel' : '+ Register Agent'}
        </button>
      </div>

      {showForm && (
        <RegisterForm onSubmit={handleRegister} onCancel={() => setShowForm(false)} />
      )}

      {agentsQuery.loading && (
        <div className="py-12 text-center text-sm text-gray-500">Loading...</div>
      )}
      {agentsQuery.error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {agentsQuery.error}
        </div>
      )}

      {!agentsQuery.loading && filtered.length === 0 && (
        <div className="rounded-lg border border-gray-200 bg-white py-12 text-center">
          <div className="text-4xl mb-3">🤖</div>
          <p className="text-gray-500">No mesh agents registered yet.</p>
        </div>
      )}

      <div className="rounded-lg border border-gray-200 bg-white overflow-hidden">
        {filtered.length > 0 && (
          <>
            <div className="px-4 py-2 border-b border-gray-200 bg-gray-50 text-xs text-gray-500">
              {filtered.length} agent(s)
            </div>
            <div className="divide-y divide-gray-200">
              {filtered.map((agent) => (
                <div
                  key={agent.name}
                  className="flex items-start justify-between gap-4 py-4 px-4 hover:bg-gray-50 transition-colors"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      <h3 className="text-sm font-medium text-gray-900">{agent.name}</h3>
                      <span className="inline-flex items-center rounded-full bg-green-50 px-2 py-0.5 text-xs font-medium text-green-700">
                        {agent.protocol}
                      </span>
                    </div>
                    <p className="text-sm text-gray-600">{agent.description}</p>
                    <div className="flex flex-wrap gap-1.5 mt-2">
                      {agent.capabilities.map((cap) => (
                        <span
                          key={cap}
                          className="inline-flex items-center rounded-full bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700"
                        >
                          {cap}
                        </span>
                      ))}
                    </div>
                    <div className="flex items-center gap-4 mt-2 text-xs text-gray-400">
                      <span>Endpoint: {agent.endpoint}</span>
                      <span>Last seen: {new Date(agent.last_seen).toLocaleString()}</span>
                    </div>
                  </div>
                  <button
                    onClick={() => handleUnregister(agent.name)}
                    className="text-sm text-red-600 hover:text-red-800 flex-shrink-0"
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ─── Network / Discovery Tab ────────────────────────────────

function NetworkTab(): React.ReactElement {
  const [searchQuery, setSearchQuery] = useState('');
  const agentsQuery = useApi(() => getMeshAgents(), []);
  const agents = agentsQuery.data ?? [];

  const [searchResults, setSearchResults] = useState<
    { agent: MeshAgent; score: number; matchedTerms: string[] }[] | null
  >(null);

  const handleSearch = async () => {
    if (!searchQuery.trim()) {
      setSearchResults(null);
      return;
    }
    const results = await discoverAgents(searchQuery.trim());
    setSearchResults(results);
  };

  const displayAgents = searchResults ? searchResults.map((r) => r.agent) : agents;

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-gray-200 bg-white p-4">
        <div className="flex flex-col md:flex-row gap-3">
          <input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
            placeholder="Discover agents by capability (e.g. coding, fitness)..."
            className="flex-1 rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
          <button
            onClick={handleSearch}
            className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
          >
            🔍 Discover
          </button>
          {searchResults && (
            <button
              onClick={() => {
                setSearchResults(null);
                setSearchQuery('');
              }}
              className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              Clear
            </button>
          )}
        </div>
        {searchResults && (
          <p className="text-xs text-gray-500 mt-2">
            {searchResults.length} result(s) for &quot;{searchQuery}&quot;
          </p>
        )}
      </div>

      {agentsQuery.loading && (
        <div className="py-12 text-center text-sm text-gray-500">Loading...</div>
      )}
      {agentsQuery.error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {agentsQuery.error}
        </div>
      )}

      {!agentsQuery.loading && displayAgents.length === 0 && (
        <div className="rounded-lg border border-gray-200 bg-white py-12 text-center">
          <div className="text-4xl mb-3">🌐</div>
          <p className="text-gray-500">No agents found.</p>
        </div>
      )}

      {displayAgents.length > 0 && (
        <div className="rounded-lg border border-gray-200 bg-white overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50 text-left text-xs text-gray-500">
                <th className="px-4 py-2 font-medium">Agent</th>
                <th className="px-4 py-2 font-medium">Description</th>
                <th className="px-4 py-2 font-medium">Capabilities</th>
                <th className="px-4 py-2 font-medium">Protocol</th>
                <th className="px-4 py-2 font-medium">Last Seen</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {displayAgents.map((agent) => (
                <tr key={agent.name} className="hover:bg-gray-50 transition-colors">
                  <td className="px-4 py-3 text-sm font-medium text-gray-900">{agent.name}</td>
                  <td className="px-4 py-3 text-sm text-gray-600">{agent.description}</td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-1">
                      {agent.capabilities.map((c) => (
                        <span
                          key={c}
                          className="inline-flex items-center rounded-full bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700"
                        >
                          {c}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-600">{agent.protocol}</td>
                  <td className="px-4 py-3 text-sm text-gray-600">
                    {new Date(agent.last_seen).toLocaleString()}
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

// ─── Overview Tab (Observability Agents) ────────────────────

function OverviewTab(): React.ReactElement {
  const navigate = useNavigate();
  const { data: agents, loading, error } = useApi(
    () => getAgents() as Promise<AgentWithErrorRate[]>,
    [],
  );

  const sorted = (agents ?? [])
    .slice()
    .sort((a, b) => new Date(b.lastSeenAt).getTime() - new Date(a.lastSeenAt).getTime());

  return (
    <div className="space-y-4">
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

// ─── Main Component ─────────────────────────────────────────

const TABS: { key: Tab; label: string; meshOnly?: boolean }[] = [
  { key: 'overview', label: 'Overview' },
  { key: 'registry', label: 'Registry', meshOnly: true },
  { key: 'network', label: 'Discovery', meshOnly: true },
];

export function Agents(): React.ReactElement {
  const [activeTab, setActiveTab] = useState<Tab>('overview');
  const { mesh } = useFeatures();

  const visibleTabs = TABS.filter((t) => !t.meshOnly || mesh);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Agents</h1>
        <p className="text-sm text-gray-500 mt-1">
          Monitor agents, manage the mesh registry, and discover capabilities
        </p>
      </div>

      {/* Tabs */}
      {visibleTabs.length > 1 && (
        <div className="border-b border-gray-200">
          <nav className="flex gap-6 -mb-px">
            {visibleTabs.map((tab) => (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={`pb-3 text-sm font-medium border-b-2 transition-colors ${
                  activeTab === tab.key
                    ? 'border-blue-600 text-blue-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </nav>
        </div>
      )}

      {/* Tab Content */}
      {activeTab === 'overview' && <OverviewTab />}
      {activeTab === 'registry' && mesh && <RegistryTab />}
      {activeTab === 'network' && mesh && <NetworkTab />}
    </div>
  );
}
