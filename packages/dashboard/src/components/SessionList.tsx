/**
 * SessionList — Table display for session data (Story 7.1)
 *
 * Renders a sortable table with status badges, pagination,
 * and delegated filter controls.
 */
import React, { useMemo, useRef } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { Link } from 'react-router-dom';
import type { Session, SessionStatus } from '@agentlensai/core';

// ─── Types ──────────────────────────────────────────────────────────

export type SortField = 'agentName' | 'status' | 'startedAt' | 'duration' | 'eventCount' | 'errorCount' | 'cost';
export type SortDir = 'asc' | 'desc';

export interface SessionListProps {
  sessions: Session[];
  sortField: SortField;
  sortDir: SortDir;
  onSort: (field: SortField) => void;
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
}

// ─── Helpers ────────────────────────────────────────────────────────

const STATUS_BADGES: Record<SessionStatus, { label: string; icon: string; className: string }> = {
  completed: { label: 'Completed', icon: '✅', className: 'bg-green-100 text-green-800' },
  error:     { label: 'Error',     icon: '❌', className: 'bg-red-100 text-red-800' },
  active:    { label: 'Active',    icon: '🔄', className: 'bg-blue-100 text-blue-800' },
};

function StatusBadge({ status }: { status: SessionStatus }) {
  const badge = STATUS_BADGES[status] ?? STATUS_BADGES.active;
  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${badge.className}`}
    >
      <span>{badge.icon}</span>
      {badge.label}
    </span>
  );
}

function formatDuration(startedAt: string, endedAt?: string): string {
  const start = new Date(startedAt).getTime();
  const end = endedAt ? new Date(endedAt).getTime() : Date.now();
  const diffMs = end - start;
  if (diffMs < 1000) return `${diffMs}ms`;
  const secs = Math.floor(diffMs / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  const remSecs = secs % 60;
  if (mins < 60) return `${mins}m ${remSecs}s`;
  const hrs = Math.floor(mins / 60);
  const remMins = mins % 60;
  return `${hrs}h ${remMins}m`;
}

function formatTimestamp(ts: string): string {
  const d = new Date(ts);
  return d.toLocaleString(undefined, {
    month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
}

// ─── Sort indicator ─────────────────────────────────────────────────

function SortIndicator({ field, sortField, sortDir }: { field: SortField; sortField: SortField; sortDir: SortDir }) {
  if (field !== sortField) return <span className="text-gray-300 ml-1">⇅</span>;
  return <span className="ml-1">{sortDir === 'asc' ? '↑' : '↓'}</span>;
}

// ─── Column header ──────────────────────────────────────────────────

function getAriaSortValue(field: SortField, sortField: SortField, sortDir: SortDir): 'ascending' | 'descending' | 'none' {
  if (field !== sortField) return 'none';
  return sortDir === 'asc' ? 'ascending' : 'descending';
}

function Th({
  field, label, sortField, sortDir, onSort, className = '',
}: {
  field: SortField; label: string; sortField: SortField; sortDir: SortDir;
  onSort: (f: SortField) => void; className?: string;
}) {
  return (
    <th
      className={`px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider ${className}`}
      aria-sort={getAriaSortValue(field, sortField, sortDir)}
    >
      <button
        type="button"
        onClick={() => onSort(field)}
        className="inline-flex items-center gap-0.5 cursor-pointer select-none hover:text-gray-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-1 rounded"
      >
        {label}
        <SortIndicator field={field} sortField={sortField} sortDir={sortDir} />
      </button>
    </th>
  );
}

// ─── Component ──────────────────────────────────────────────────────

const ESTIMATED_ROW_HEIGHT = 48;

export function SessionList({
  sessions, sortField, sortDir, onSort, page, pageSize, total, onPageChange,
}: SessionListProps) {
  const totalPages = useMemo(() => Math.max(1, Math.ceil(total / pageSize)), [total, pageSize]);
  const parentRef = useRef<HTMLDivElement>(null);

  const virtualizer = useVirtualizer({
    count: sessions.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ESTIMATED_ROW_HEIGHT,
    overscan: 10,
  });

  if (sessions.length === 0) {
    return (
      <div className="text-center py-12 text-gray-500">
        <p className="text-lg">No sessions found</p>
        <p className="text-sm mt-1">Try adjusting your filters</p>
      </div>
    );
  }

  return (
    <div>
      {/* Table */}
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <Th field="agentName" label="Agent" sortField={sortField} sortDir={sortDir} onSort={onSort} />
              <Th field="status" label="Status" sortField={sortField} sortDir={sortDir} onSort={onSort} />
              <Th field="startedAt" label="Started" sortField={sortField} sortDir={sortDir} onSort={onSort} />
              <Th field="duration" label="Duration" sortField={sortField} sortDir={sortDir} onSort={onSort} />
              <Th field="eventCount" label="Events" sortField={sortField} sortDir={sortDir} onSort={onSort} />
              <Th field="errorCount" label="Errors" sortField={sortField} sortDir={sortDir} onSort={onSort} />
              <Th field="cost" label="Cost" sortField={sortField} sortDir={sortDir} onSort={onSort} />
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">
                Tags
              </th>
            </tr>
          </thead>
        </table>
        <div
          ref={parentRef}
          className="max-h-[calc(100vh-20rem)] overflow-auto"
        >
          <div style={{ height: `${virtualizer.getTotalSize()}px`, width: '100%', position: 'relative' }}>
            <table className="min-w-full">
              <tbody className="bg-white divide-y divide-gray-200">
                {virtualizer.getVirtualItems().map((virtualRow) => {
                  const s = sessions[virtualRow.index];
                  if (!s) return null;
                  return (
                    <tr
                      key={virtualRow.key}
                      data-index={virtualRow.index}
                      ref={virtualizer.measureElement}
                      className="hover:bg-gray-50 transition-colors"
                      style={{
                        position: 'absolute',
                        top: 0,
                        left: 0,
                        width: '100%',
                        transform: `translateY(${virtualRow.start}px)`,
                      }}
                    >
                      <td className="px-4 py-3 whitespace-nowrap">
                        <Link
                          to={`/sessions/${s.id}`}
                          className="text-blue-600 hover:text-blue-800 font-medium"
                        >
                          {s.agentName ?? s.agentId}
                        </Link>
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <StatusBadge status={s.status} />
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-600">
                        {formatTimestamp(s.startedAt)}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-600">
                        {formatDuration(s.startedAt, s.endedAt)}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-600">
                        {s.eventCount}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap text-sm">
                        <span className={s.errorCount > 0 ? 'text-red-600 font-medium' : 'text-gray-600'}>
                          {s.errorCount}
                        </span>
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-600 font-mono">
                        {s.totalCostUsd > 0 ? `$${s.totalCostUsd.toFixed(4)}` : '—'}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <div className="flex flex-wrap gap-1">
                          {s.tags.map((tag) => (
                            <span
                              key={tag}
                              className="inline-block px-2 py-0.5 text-xs bg-gray-100 text-gray-600 rounded"
                            >
                              {tag}
                            </span>
                          ))}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between px-4 py-3 border-t border-gray-200">
          <div className="text-sm text-gray-500">
            Showing {page * pageSize + 1}–{Math.min((page + 1) * pageSize, total)} of {total}
          </div>
          <div className="flex items-center gap-2">
            <button
              className="px-3 py-1 text-sm rounded border border-gray-300 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
              disabled={page === 0}
              onClick={() => onPageChange(page - 1)}
            >
              ← Prev
            </button>
            <span className="text-sm text-gray-600">
              Page {page + 1} of {totalPages}
            </span>
            <button
              className="px-3 py-1 text-sm rounded border border-gray-300 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
              disabled={page >= totalPages - 1}
              onClick={() => onPageChange(page + 1)}
            >
              Next →
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
