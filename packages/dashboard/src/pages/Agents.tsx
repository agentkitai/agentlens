/**
 * Unified Agents Page
 *
 * Two modes:
 * - Mesh disabled: Shows local (telemetry) agents only. No registration.
 * - Mesh enabled: Two sections — Local Agents (with register/unregister per agent)
 *   and Mesh Registry (all registered agents with discovery).
 *
 * Route: /agents
 */

import React, { useState, useCallback, useMemo } from 'react';
import { useApi } from '../hooks/useApi';
import { useFeatures } from '../hooks/useFeatures';
import {
  getMeshAgents,
  registerMeshAgent,
  unregisterMeshAgent,
  discoverAgents,
  type MeshAgent,
} from '../api/discovery';
import { getAgents } from '../api/agents';
import type { Agent as TelemetryAgent } from '../api/core';
import { listBudgets, getBudgetStatus, type CostBudgetStatusData } from '../api/budgets';
import { BudgetStatusBadge } from '../components/BudgetStatusBadge';

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

// ─── Local Agent Card ───────────────────────────────────────

function LocalAgentCard({
  agent,
  meshEnabled,
  isRegistered,
  onRegister,
  onSelect,
  selected,
  budgetStatus,
}: {
  agent: TelemetryAgent;
  meshEnabled: boolean;
  isRegistered: boolean;
  onRegister: () => void;
  onSelect: () => void;
  selected: boolean;
  budgetStatus?: CostBudgetStatusData;
}): React.ReactElement {
  const status = statusDot(agent.lastSeenAt);

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
            {meshEnabled && (
              isRegistered ? (
                <span className="inline-flex items-center rounded-full bg-green-50 px-2 py-0.5 text-xs font-medium text-green-700">
                  Registered
                </span>
              ) : (
                <span className="inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-500">
                  Local only
                </span>
              )
            )}
          </div>
          {agent.description && (
            <p className="truncate text-xs text-gray-500">{agent.description}</p>
          )}
        </div>
      </div>

      {budgetStatus && (
        <div className="mt-2 px-1">
          <BudgetStatusBadge
            currentSpend={budgetStatus.currentSpend}
            limitUsd={budgetStatus.limitUsd}
            periodLabel={budgetStatus.budget.period}
            compact
          />
        </div>
      )}

      <div className="mt-3 flex items-center justify-between border-t border-gray-100 pt-3 text-xs text-gray-400">
        <span>{agent.sessionCount} session{agent.sessionCount !== 1 ? 's' : ''}</span>
        <div className="flex items-center gap-2">
          {agent.pausedAt && (
            <span className="text-red-500 font-medium">⏸ Paused</span>
          )}
          <span>Last seen {timeAgo(agent.lastSeenAt)}</span>
        </div>
      </div>

      {meshEnabled && !isRegistered && (
        <div className="mt-2 pt-2 border-t border-gray-100">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onRegister();
            }}
            className="w-full rounded-md border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs font-medium text-blue-700 hover:bg-blue-100"
          >
            Register in Mesh
          </button>
        </div>
      )}
    </button>
  );
}

// ─── Mesh Agent Card ────────────────────────────────────────

function MeshAgentCard({
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

      {agent.capabilities.length > 0 && (
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
      )}

      <div className="mt-3 flex items-center justify-between border-t border-gray-100 pt-3 text-xs text-gray-400">
        <span>{agent.protocol || 'No protocol'}</span>
        <div className="flex items-center gap-2">
          {telemetry?.pausedAt && (
            <span className="text-red-500 font-medium">⏸ Paused</span>
          )}
          <span>Last seen {timeAgo(telemetry?.lastSeenAt ?? agent.last_seen)}</span>
        </div>
      </div>
    </button>
  );
}

// ─── Agent Detail Panel ─────────────────────────────────────

function LocalAgentDetail({
  agent,
  onClose,
}: {
  agent: TelemetryAgent;
  onClose: () => void;
}): React.ReactElement {
  const status = statusDot(agent.lastSeenAt);

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
            {agent.description && <p className="text-sm text-gray-500">{agent.description}</p>}
          </div>
        </div>
        <button
          onClick={onClose}
          className="rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50"
        >
          Close
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="rounded-lg bg-gray-50 p-3">
          <p className="text-xs text-gray-500 mb-1">Sessions</p>
          <p className="text-sm font-semibold text-gray-900">{agent.sessionCount}</p>
        </div>
        <div className="rounded-lg bg-gray-50 p-3">
          <p className="text-xs text-gray-500 mb-1">First Seen</p>
          <p className="text-sm text-gray-900">{new Date(agent.firstSeenAt).toLocaleString()}</p>
        </div>
        <div className="rounded-lg bg-gray-50 p-3">
          <p className="text-xs text-gray-500 mb-1">Last Seen</p>
          <p className="text-sm text-gray-900">{new Date(agent.lastSeenAt).toLocaleString()}</p>
        </div>
        {agent.pausedAt && (
          <div className="rounded-lg bg-red-50 p-3">
            <p className="text-xs text-red-500 mb-1">Paused</p>
            <p className="text-sm text-red-700">{agent.pauseReason ?? 'By guardrail'}</p>
          </div>
        )}
        {agent.modelOverride && (
          <div className="rounded-lg bg-amber-50 p-3">
            <p className="text-xs text-amber-500 mb-1">Model Override</p>
            <p className="text-sm text-amber-700">{agent.modelOverride}</p>
          </div>
        )}
      </div>

      <div className="text-xs text-gray-400">
        Tenant: {agent.tenantId}
      </div>
    </div>
  );
}

function MeshAgentDetail({
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
        {telemetry?.pausedAt && (
          <div className="rounded-lg bg-red-50 p-3">
            <p className="text-xs text-red-500 mb-1">Paused</p>
            <p className="text-sm text-red-700">{telemetry.pauseReason ?? 'By guardrail'}</p>
          </div>
        )}
      </div>

      {agent.capabilities.length > 0 && (
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
          </div>
        </div>
      )}

      <div className="text-xs text-gray-400">
        Last seen: {new Date(agent.last_seen).toLocaleString()}
      </div>
    </div>
  );
}

// ─── Main Component ─────────────────────────────────────────

export function Agents(): React.ReactElement {
  const { mesh: meshEnabled, loading: featuresLoading } = useFeatures();
  const [search, setSearch] = useState('');
  const [selectedLocal, setSelectedLocal] = useState<string | null>(null);
  const [selectedMesh, setSelectedMesh] = useState<string | null>(null);
  const [discoveryQuery, setDiscoveryQuery] = useState('');
  const [discoveryResults, setDiscoveryResults] = useState<
    { agent: MeshAgent; score: number; matchedTerms: string[] }[] | null
  >(null);

  // Always fetch local (telemetry) agents
  const telemetryQuery = useApi(() => getAgents(), []);
  // Filter out the generic 'main' agent — it's the default telemetry ID for the
  // orchestrator session and duplicates the named agent (e.g. openclaw-brad).
  const telemetryAgents = (telemetryQuery.data ?? []).filter((a) => a.name !== 'main');

  // Only fetch mesh agents when mesh is enabled
  const meshQuery = useApi(() => (meshEnabled ? getMeshAgents() : Promise.resolve([])), [meshEnabled]);
  const meshAgents = meshQuery.data ?? [];

  // Set of mesh-registered agent names (lowercase) for quick lookup
  const meshRegisteredNames = useMemo(() => {
    const set = new Set<string>();
    for (const m of meshAgents) set.add(m.name.toLowerCase());
    return set;
  }, [meshAgents]);

  // Telemetry lookup by name for mesh agent enrichment
  const telemetryMap = useMemo(() => {
    const map = new Map<string, TelemetryAgent>();
    for (const t of telemetryAgents) {
      map.set(t.name.toLowerCase(), t);
      const stripped = t.name.toLowerCase().replace(/^openclaw-/, '');
      if (stripped !== t.name.toLowerCase()) map.set(stripped, t);
    }
    return map;
  }, [telemetryAgents]);

  // Budget statuses
  const [agentBudgetStatuses, setAgentBudgetStatuses] = React.useState<Record<string, CostBudgetStatusData>>({});
  React.useEffect(() => {
    listBudgets({ scope: 'agent', enabled: true }).then(({ budgets }) => {
      budgets.forEach((b) => {
        getBudgetStatus(b.id).then((status) => {
          setAgentBudgetStatuses((prev) => ({
            ...prev,
            ...(b.agentId ? { [b.agentId]: status } : {}),
          }));
        }).catch(() => {});
      });
    }).catch(() => {});
  }, []);

  // Filter local agents
  const filteredLocal = telemetryAgents.filter(
    (a) =>
      !search ||
      a.name.toLowerCase().includes(search.toLowerCase()) ||
      (a.description ?? '').toLowerCase().includes(search.toLowerCase()),
  );

  // Filter mesh agents (or discovery results)
  const meshToShow = discoveryResults ? discoveryResults.map((r) => r.agent) : meshAgents;
  const filteredMesh = meshToShow.filter(
    (a) =>
      !search ||
      a.name.toLowerCase().includes(search.toLowerCase()) ||
      a.description.toLowerCase().includes(search.toLowerCase()) ||
      a.capabilities.some((c) => c.toLowerCase().includes(search.toLowerCase())),
  );

  const selectedLocalAgent = telemetryAgents.find((a) => a.name === selectedLocal) ?? null;
  const selectedMeshAgent = meshAgents.find((a) => a.name === selectedMesh) ?? null;

  const handleUnregister = useCallback(
    async (name: string) => {
      if (!confirm(`Unregister agent "${name}" from mesh?`)) return;
      await unregisterMeshAgent(name);
      if (selectedMesh === name) setSelectedMesh(null);
      meshQuery.refetch();
    },
    [meshQuery, selectedMesh],
  );

  const handleRegisterLocal = useCallback(
    async (agent: TelemetryAgent) => {
      await registerMeshAgent({
        name: agent.name,
        description: agent.description || '',
        capabilities: [],
        endpoint: '',
      });
      meshQuery.refetch();
    },
    [meshQuery],
  );

  const handleDiscover = async () => {
    if (!discoveryQuery.trim()) {
      setDiscoveryResults(null);
      return;
    }
    const resp = await discoverAgents({ query: discoveryQuery.trim() });
    setDiscoveryResults(resp.results as { agent: MeshAgent; score: number; matchedTerms: string[] }[]);
  };

  const loading = featuresLoading || telemetryQuery.loading;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Agents</h1>
        <p className="text-sm text-gray-500 mt-1">
          {meshEnabled
            ? 'Manage local agents and mesh registry'
            : 'View agents observed through telemetry'}
        </p>
      </div>

      {/* Search */}
      <div className="rounded-lg border border-gray-200 bg-white p-4">
        <div className="flex flex-col md:flex-row gap-3">
          <input
            type="text"
            placeholder="Filter agents..."
            className="flex-1 rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            data-testid="search-input"
          />
          {meshEnabled && (
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
          )}
        </div>
        {discoveryResults && (
          <p className="text-xs text-gray-500 mt-2">
            {discoveryResults.length} result(s) for &quot;{discoveryQuery}&quot;
          </p>
        )}
      </div>

      {/* Loading */}
      {loading && (
        <div className="py-12 text-center text-sm text-gray-500">Loading agents…</div>
      )}

      {/* Errors (non-fatal) */}
      {telemetryQuery.error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {telemetryQuery.error}
        </div>
      )}

      {/* ── Local Agent Detail ── */}
      {selectedLocalAgent && (
        <LocalAgentDetail
          agent={selectedLocalAgent}
          onClose={() => setSelectedLocal(null)}
        />
      )}

      {/* ── Mesh Agent Detail ── */}
      {selectedMeshAgent && (
        <MeshAgentDetail
          agent={selectedMeshAgent}
          telemetry={telemetryMap.get(selectedMeshAgent.name.toLowerCase())}
          onClose={() => setSelectedMesh(null)}
          onUnregister={() => handleUnregister(selectedMeshAgent.name)}
        />
      )}

      {/* ── Local Agents Section ── */}
      {!loading && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-gray-900">
              {meshEnabled ? 'Local Agents' : 'Agents'}
            </h2>
            <span className="text-sm text-gray-500">
              {filteredLocal.length} agent{filteredLocal.length !== 1 ? 's' : ''}
            </span>
          </div>

          {filteredLocal.length === 0 ? (
            <div className="rounded-lg border border-gray-200 bg-white py-12 text-center">
              <div className="text-4xl mb-3">🤖</div>
              <p className="text-gray-500">No agents found</p>
              <p className="mt-1 text-sm text-gray-400">
                Agents appear here once they start sending telemetry
              </p>
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {filteredLocal.map((agent) => (
                <LocalAgentCard
                  key={agent.name}
                  agent={agent}
                  meshEnabled={meshEnabled}
                  isRegistered={meshRegisteredNames.has(agent.name.toLowerCase())}
                  onRegister={() => handleRegisterLocal(agent)}
                  onSelect={() =>
                    setSelectedLocal(selectedLocal === agent.name ? null : agent.name)
                  }
                  selected={selectedLocal === agent.name}
                  budgetStatus={agentBudgetStatuses[agent.name]}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Mesh Registry Section (only when mesh enabled) ── */}
      {meshEnabled && !loading && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-gray-900">Mesh Registry</h2>
            <span className="text-sm text-gray-500">
              {filteredMesh.length} registered agent{filteredMesh.length !== 1 ? 's' : ''}
            </span>
          </div>

          {meshQuery.error && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-700">
              Could not reach mesh service: {meshQuery.error}
            </div>
          )}

          {filteredMesh.length === 0 && !meshQuery.error ? (
            <div className="rounded-lg border border-gray-200 bg-white py-8 text-center">
              <p className="text-gray-500">No agents registered in mesh</p>
              <p className="mt-1 text-sm text-gray-400">
                Register local agents above to add them to the mesh
              </p>
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {filteredMesh.map((agent) => (
                <MeshAgentCard
                  key={agent.name}
                  agent={agent}
                  telemetry={telemetryMap.get(agent.name.toLowerCase())}
                  selected={selectedMesh === agent.name}
                  onSelect={() =>
                    setSelectedMesh(selectedMesh === agent.name ? null : agent.name)
                  }
                  onUnregister={() => handleUnregister(agent.name)}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
