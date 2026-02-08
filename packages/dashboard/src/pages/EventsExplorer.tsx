/**
 * Events Explorer Page (Story 8.1)
 *
 * Route: /events (replaces placeholder Events page)
 * - Table columns: Timestamp, Type, Name, Agent, Session, Level, Duration
 * - Filter bar: event type multi-select, severity multi-select, agent dropdown, time range
 * - Free-text search
 * - Click row → expand inline with payload preview
 * - Pagination controls
 */

import React, { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import type {
  EventType,
  EventSeverity,
  AgentLensEvent,
  EventQuery,
  Agent,
} from '@agentlens/core';
import { EVENT_TYPES, EVENT_SEVERITIES } from '@agentlens/core';
import { getEvents, getAgents } from '../api/client';
import { useApi } from '../hooks/useApi';

// ─── Constants ──────────────────────────────────────────────

const PAGE_SIZE = 50;

const SEVERITY_COLORS: Record<EventSeverity, string> = {
  debug: 'bg-gray-100 text-gray-700',
  info: 'bg-blue-100 text-blue-700',
  warn: 'bg-yellow-100 text-yellow-800',
  error: 'bg-red-100 text-red-700',
  critical: 'bg-red-200 text-red-900 font-bold',
};

const TYPE_LABELS: Record<EventType, string> = {
  session_started: 'Session Started',
  session_ended: 'Session Ended',
  tool_call: 'Tool Call',
  tool_response: 'Tool Response',
  tool_error: 'Tool Error',
  approval_requested: 'Approval Requested',
  approval_granted: 'Approval Granted',
  approval_denied: 'Approval Denied',
  approval_expired: 'Approval Expired',
  form_submitted: 'Form Submitted',
  form_completed: 'Form Completed',
  form_expired: 'Form Expired',
  cost_tracked: 'Cost Tracked',
  alert_triggered: 'Alert Triggered',
  alert_resolved: 'Alert Resolved',
  custom: 'Custom',
};

// ─── Filter State ───────────────────────────────────────────

interface Filters {
  eventTypes: EventType[];
  severities: EventSeverity[];
  agentId: string;
  from: string;
  to: string;
  search: string;
}

const EMPTY_FILTERS: Filters = {
  eventTypes: [],
  severities: [],
  agentId: '',
  from: '',
  to: '',
  search: '',
};

// ─── Helpers ────────────────────────────────────────────────

function getEventName(event: AgentLensEvent): string {
  const p = event.payload as Record<string, unknown>;
  if ('toolName' in p && typeof p.toolName === 'string') return p.toolName;
  if ('action' in p && typeof p.action === 'string') return p.action;
  if ('alertName' in p && typeof p.alertName === 'string') return p.alertName;
  if ('formName' in p && typeof p.formName === 'string') return p.formName;
  if ('type' in p && typeof p.type === 'string') return p.type;
  return '—';
}

function getEventDuration(event: AgentLensEvent): string {
  const p = event.payload as Record<string, unknown>;
  if ('durationMs' in p && typeof p.durationMs === 'number') {
    return `${p.durationMs.toLocaleString()}ms`;
  }
  if ('totalDurationMs' in p && typeof p.totalDurationMs === 'number') {
    return `${p.totalDurationMs.toLocaleString()}ms`;
  }
  if ('expiredAfterMs' in p && typeof p.expiredAfterMs === 'number') {
    return `${p.expiredAfterMs.toLocaleString()}ms`;
  }
  return '—';
}

function formatTimestamp(ts: string): string {
  try {
    const d = new Date(ts);
    return d.toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  } catch {
    return ts;
  }
}

// ─── Multi-Select Dropdown ──────────────────────────────────

interface MultiSelectProps<T extends string> {
  label: string;
  options: readonly T[];
  selected: T[];
  onChange: (values: T[]) => void;
  formatOption?: (opt: T) => string;
}

function MultiSelect<T extends string>({
  label,
  options,
  selected,
  onChange,
  formatOption,
}: MultiSelectProps<T>): React.ReactElement {
  const [open, setOpen] = useState(false);

  const toggle = (value: T) => {
    if (selected.includes(value)) {
      onChange(selected.filter((v) => v !== value));
    } else {
      onChange([...selected, value]);
    }
  };

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1 rounded border border-gray-300 bg-white px-3 py-1.5 text-sm hover:border-gray-400"
      >
        {label}
        {selected.length > 0 && (
          <span className="ml-1 rounded-full bg-indigo-100 px-1.5 text-xs text-indigo-700">
            {selected.length}
          </span>
        )}
        <svg className="ml-1 h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {open && (
        <div className="absolute z-20 mt-1 max-h-60 w-56 overflow-auto rounded border border-gray-200 bg-white shadow-lg">
          {options.map((opt) => (
            <label
              key={opt}
              className="flex cursor-pointer items-center gap-2 px-3 py-1.5 text-sm hover:bg-gray-50"
            >
              <input
                type="checkbox"
                checked={selected.includes(opt)}
                onChange={() => toggle(opt)}
                className="rounded border-gray-300"
              />
              {formatOption ? formatOption(opt) : opt}
            </label>
          ))}
          {selected.length > 0 && (
            <button
              type="button"
              onClick={() => onChange([])}
              className="w-full border-t px-3 py-1.5 text-left text-xs text-gray-500 hover:bg-gray-50"
            >
              Clear all
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Payload Preview ────────────────────────────────────────

function PayloadPreview({ event }: { event: AgentLensEvent }): React.ReactElement {
  return (
    <tr>
      <td colSpan={7} className="bg-gray-50 px-6 py-4">
        <div className="space-y-2">
          <div className="flex gap-4 text-xs text-gray-500">
            <span>ID: {event.id}</span>
            <span>Hash: {event.hash.slice(0, 12)}…</span>
            {event.prevHash && <span>PrevHash: {event.prevHash.slice(0, 12)}…</span>}
          </div>
          {Object.keys(event.metadata).length > 0 && (
            <div>
              <span className="text-xs font-medium text-gray-600">Metadata:</span>
              <pre className="mt-1 max-h-24 overflow-auto rounded bg-gray-100 p-2 text-xs">
                {JSON.stringify(event.metadata, null, 2)}
              </pre>
            </div>
          )}
          <div>
            <span className="text-xs font-medium text-gray-600">Payload:</span>
            <pre className="mt-1 max-h-64 overflow-auto rounded bg-gray-100 p-2 text-xs">
              {JSON.stringify(event.payload, null, 2)}
            </pre>
          </div>
        </div>
      </td>
    </tr>
  );
}

// ─── Main Component ─────────────────────────────────────────

export function EventsExplorer(): React.ReactElement {
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [page, setPage] = useState(0);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // Debounce search input (300ms) to avoid firing API calls on every keystroke
  const [debouncedSearch, setDebouncedSearch] = useState(filters.search);
  const debounceTimer = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    debounceTimer.current = setTimeout(() => {
      setDebouncedSearch(filters.search);
    }, 300);
    return () => clearTimeout(debounceTimer.current);
  }, [filters.search]);

  const query = useMemo((): EventQuery => {
    const q: EventQuery = {
      limit: PAGE_SIZE,
      offset: page * PAGE_SIZE,
      order: 'desc',
    };
    if (filters.eventTypes.length > 0) q.eventType = filters.eventTypes;
    if (filters.severities.length > 0) q.severity = filters.severities;
    if (filters.agentId) q.agentId = filters.agentId;
    if (filters.from) q.from = new Date(filters.from).toISOString();
    if (filters.to) q.to = new Date(filters.to).toISOString();
    if (debouncedSearch.trim()) q.search = debouncedSearch.trim();
    return q;
  }, [filters.eventTypes, filters.severities, filters.agentId, filters.from, filters.to, debouncedSearch, page]);

  const { data: result, loading, error } = useApi(
    () => getEvents(query),
    [JSON.stringify(query)],
  );

  const { data: agents } = useApi(() => getAgents(), []);

  const updateFilter = useCallback(<K extends keyof Filters>(key: K, value: Filters[K]) => {
    setFilters((f) => ({ ...f, [key]: value }));
    setPage(0);
  }, []);

  const totalPages = result ? Math.ceil(result.total / PAGE_SIZE) : 0;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Events Explorer</h1>
        {result && (
          <span className="text-sm text-gray-500">
            {result.total.toLocaleString()} event{result.total !== 1 ? 's' : ''}
          </span>
        )}
      </div>

      {/* Filter Bar */}
      <div className="flex flex-wrap items-center gap-3 rounded-lg border border-gray-200 bg-white p-3">
        <div className="flex-1">
          <input
            type="text"
            placeholder="Search events…"
            value={filters.search}
            onChange={(e) => updateFilter('search', e.target.value)}
            className="w-full rounded border border-gray-300 px-3 py-1.5 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          />
        </div>

        <MultiSelect
          label="Event Type"
          options={EVENT_TYPES}
          selected={filters.eventTypes}
          onChange={(v) => updateFilter('eventTypes', v)}
          formatOption={(t) => TYPE_LABELS[t]}
        />

        <MultiSelect
          label="Severity"
          options={EVENT_SEVERITIES}
          selected={filters.severities}
          onChange={(v) => updateFilter('severities', v)}
        />

        <select
          value={filters.agentId}
          onChange={(e) => updateFilter('agentId', e.target.value)}
          className="rounded border border-gray-300 bg-white px-3 py-1.5 text-sm"
        >
          <option value="">All Agents</option>
          {(agents ?? []).map((a: Agent) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>

        <input
          type="datetime-local"
          value={filters.from}
          onChange={(e) => updateFilter('from', e.target.value)}
          className="rounded border border-gray-300 px-2 py-1.5 text-sm"
          title="From date"
        />
        <span className="text-gray-400">→</span>
        <input
          type="datetime-local"
          value={filters.to}
          onChange={(e) => updateFilter('to', e.target.value)}
          className="rounded border border-gray-300 px-2 py-1.5 text-sm"
          title="To date"
        />

        {JSON.stringify(filters) !== JSON.stringify(EMPTY_FILTERS) && (
          <button
            type="button"
            onClick={() => { setFilters(EMPTY_FILTERS); setPage(0); }}
            className="text-sm text-gray-500 hover:text-gray-700"
          >
            Clear
          </button>
        )}
      </div>

      {/* Error */}
      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* Table */}
      <div className="overflow-x-auto rounded-lg border border-gray-200">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              {['Timestamp', 'Type', 'Name', 'Agent', 'Session', 'Level', 'Duration'].map(
                (col) => (
                  <th
                    key={col}
                    className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500"
                  >
                    {col}
                  </th>
                ),
              )}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200 bg-white">
            {loading && !result && (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-sm text-gray-500">
                  Loading events…
                </td>
              </tr>
            )}
            {result && result.events.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-sm text-gray-500">
                  No events found
                </td>
              </tr>
            )}
            {result?.events.map((event) => (
              <React.Fragment key={event.id}>
                <tr
                  onClick={() => setExpandedId(expandedId === event.id ? null : event.id)}
                  className="cursor-pointer hover:bg-gray-50"
                >
                  <td className="whitespace-nowrap px-4 py-2 text-sm text-gray-600">
                    {formatTimestamp(event.timestamp)}
                  </td>
                  <td className="whitespace-nowrap px-4 py-2">
                    <span className="rounded bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-700">
                      {event.eventType}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-sm text-gray-900">
                    {getEventName(event)}
                  </td>
                  <td className="whitespace-nowrap px-4 py-2 text-sm text-gray-600">
                    {event.agentId}
                  </td>
                  <td className="whitespace-nowrap px-4 py-2 text-sm font-mono text-gray-500">
                    {event.sessionId.slice(0, 8)}…
                  </td>
                  <td className="whitespace-nowrap px-4 py-2">
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-medium ${SEVERITY_COLORS[event.severity]}`}
                    >
                      {event.severity}
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-4 py-2 text-sm text-gray-600">
                    {getEventDuration(event)}
                  </td>
                </tr>
                {expandedId === event.id && (
                  <PayloadPreview event={event} />
                )}
              </React.Fragment>
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <span className="text-sm text-gray-600">
            Page {page + 1} of {totalPages}
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={page === 0}
              className="rounded border border-gray-300 px-3 py-1 text-sm disabled:opacity-50"
            >
              ← Previous
            </button>
            <button
              type="button"
              onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
              disabled={page >= totalPages - 1}
              className="rounded border border-gray-300 px-3 py-1 text-sm disabled:opacity-50"
            >
              Next →
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
