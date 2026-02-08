/**
 * Sessions List Page (Story 7.1)
 *
 * Route: /sessions
 * Features: filter bar (agent dropdown, status multi-select),
 *           sortable table, pagination for 50+ sessions.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { SessionStatus, Agent } from '@agentlens/core';
import { getSessions, getAgents } from '../api/client';
import type { SessionQueryResult } from '@agentlens/core';
import { useApi } from '../hooks/useApi';
import { SessionList } from '../components/SessionList';
import type { SortField, SortDir } from '../components/SessionList';

// ─── Constants ──────────────────────────────────────────────────────

const PAGE_SIZE = 50;
const STATUS_OPTIONS: SessionStatus[] = ['active', 'completed', 'error'];

// ─── Component ──────────────────────────────────────────────────────

export function Sessions(): React.ReactElement {
  const [searchParams] = useSearchParams();

  // Filters — initialise agentFilter from URL ?agentId= for deep-linking
  const [agentFilter, setAgentFilter] = useState<string>(
    () => searchParams.get('agentId') ?? '',
  );
  const [statusFilters, setStatusFilters] = useState<Set<SessionStatus>>(new Set());

  // Sort
  const [sortField, setSortField] = useState<SortField>('startedAt');
  const [sortDir, setSortDir] = useState<SortDir>('desc');

  // Pagination
  const [page, setPage] = useState(0);

  // Fetch agents for dropdown
  const { data: agents } = useApi<Agent[]>(() => getAgents(), []);

  // Build query params — pass all selected statuses to server for filtering
  const queryAgentId = agentFilter || undefined;
  const statusArray = useMemo(() => [...statusFilters], [statusFilters]);
  const queryStatus = statusArray.length === 1 ? statusArray[0] : statusArray.length > 1 ? statusArray.join(',') : undefined;

  // Fetch sessions
  const { data, loading, error, refetch } = useApi(
    () =>
      getSessions({
        agentId: queryAgentId,
        status: queryStatus as SessionStatus | undefined,
        limit: PAGE_SIZE,
        offset: page * PAGE_SIZE,
      }),
    [queryAgentId, queryStatus, page],
  );

  // Reset page when filters change
  useEffect(() => {
    setPage(0);
  }, [agentFilter, statusFilters]);

  // Client-side sort (server returns by startedAt desc; status filtering is server-side)
  const sortedSessions = useMemo(() => {
    if (!data?.sessions) return [];

    return [...data.sessions].sort((a, b) => {
      let cmp = 0;
      switch (sortField) {
        case 'agentName':
          cmp = (a.agentName ?? a.agentId).localeCompare(b.agentName ?? b.agentId);
          break;
        case 'status':
          cmp = a.status.localeCompare(b.status);
          break;
        case 'startedAt':
          cmp = new Date(a.startedAt).getTime() - new Date(b.startedAt).getTime();
          break;
        case 'duration': {
          const durA = (a.endedAt ? new Date(a.endedAt).getTime() : Date.now()) - new Date(a.startedAt).getTime();
          const durB = (b.endedAt ? new Date(b.endedAt).getTime() : Date.now()) - new Date(b.startedAt).getTime();
          cmp = durA - durB;
          break;
        }
        case 'eventCount':
          cmp = a.eventCount - b.eventCount;
          break;
        case 'errorCount':
          cmp = a.errorCount - b.errorCount;
          break;
      }
      return sortDir === 'asc' ? cmp : -cmp;
    });
  }, [data?.sessions, sortField, sortDir]);

  // Sort handler
  const handleSort = useCallback(
    (field: SortField) => {
      if (field === sortField) {
        setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
      } else {
        setSortField(field);
        setSortDir('desc');
      }
    },
    [sortField],
  );

  // Status toggle
  const toggleStatus = useCallback((status: SessionStatus) => {
    setStatusFilters((prev) => {
      const next = new Set(prev);
      if (next.has(status)) {
        next.delete(status);
      } else {
        next.add(status);
      }
      return next;
    });
  }, []);

  const agentList: Agent[] = agents ?? [];

  return (
    <div className="space-y-4">
      {/* Page header */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Sessions</h1>
        <button
          onClick={refetch}
          className="px-3 py-1.5 text-sm rounded border border-gray-300 hover:bg-gray-50"
        >
          ↻ Refresh
        </button>
      </div>

      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-4 p-4 bg-white rounded-lg shadow-sm border border-gray-200">
        {/* Agent dropdown */}
        <div className="flex items-center gap-2">
          <label htmlFor="agent-filter" className="text-sm font-medium text-gray-600">
            Agent
          </label>
          <select
            id="agent-filter"
            value={agentFilter}
            onChange={(e) => setAgentFilter(e.target.value)}
            className="text-sm rounded border-gray-300 border px-2 py-1.5 bg-white"
          >
            <option value="">All agents</option>
            {agentList.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </div>

        {/* Status multi-select */}
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-gray-600">Status</span>
          <div className="flex gap-1">
            {STATUS_OPTIONS.map((status) => {
              const active = statusFilters.has(status);
              return (
                <button
                  key={status}
                  onClick={() => toggleStatus(status)}
                  className={`px-2.5 py-1 text-xs rounded-full border transition-colors ${
                    active
                      ? 'bg-blue-100 border-blue-300 text-blue-800'
                      : 'bg-white border-gray-300 text-gray-600 hover:bg-gray-50'
                  }`}
                >
                  {status === 'completed' && '✅ '}
                  {status === 'error' && '❌ '}
                  {status === 'active' && '🔄 '}
                  {status.charAt(0).toUpperCase() + status.slice(1)}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Content */}
      {error && (
        <div className="p-4 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
          Error loading sessions: {error}
        </div>
      )}

      {loading && !data ? (
        <div className="flex justify-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
        </div>
      ) : (
        <div className="bg-white rounded-lg shadow-sm border border-gray-200">
          <SessionList
            sessions={sortedSessions}
            sortField={sortField}
            sortDir={sortDir}
            onSort={handleSort}
            page={page}
            pageSize={PAGE_SIZE}
            total={data?.total ?? 0}
            onPageChange={setPage}
          />
        </div>
      )}
    </div>
  );
}
