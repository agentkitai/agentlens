/**
 * Audit Log Page (S-7.6)
 *
 * Dashboard page showing audit log entries with:
 * - Filters: action type, actor, time range
 * - Paginated table
 * - Export to JSON button
 */

import React, { useState, useCallback, useEffect } from 'react';
import { useOrg } from './OrgContext';
import {
  queryAuditLog,
  exportAuditLog,
  type AuditEntry,
  type AuditLogFilters,
} from './api';

const ACTION_TYPES = [
  'auth.login', 'auth.logout', 'auth.login_failed',
  'api_key.created', 'api_key.revoked',
  'member.invited', 'member.removed', 'member.role_changed',
  'settings.updated', 'org.ownership_transferred',
  'billing.plan_changed', 'billing.payment_failed',
  'data.exported', 'permission.denied',
];

const PAGE_SIZE = 20;

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString();
}

export function AuditLogPage(): React.ReactElement {
  const { currentOrg } = useOrg();
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [actionFilter, setActionFilter] = useState('');
  const [actorFilter, setActorFilter] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');

  const load = useCallback(async () => {
    if (!currentOrg) return;
    setLoading(true);
    setError(null);
    try {
      const filters: AuditLogFilters = {
        limit: PAGE_SIZE,
        offset: page * PAGE_SIZE,
      };
      if (actionFilter) filters.action = actionFilter;
      if (actorFilter) filters.actor = actorFilter;
      if (fromDate) filters.from = new Date(fromDate).toISOString();
      if (toDate) filters.to = new Date(toDate).toISOString();

      const result = await queryAuditLog(currentOrg.id, filters);
      setEntries(result.entries);
      setTotal(result.total);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load audit log');
    } finally {
      setLoading(false);
    }
  }, [currentOrg, page, actionFilter, actorFilter, fromDate, toDate]);

  useEffect(() => { load(); }, [load]);

  const handleExport = useCallback(async () => {
    if (!currentOrg) return;
    try {
      const data = await exportAuditLog(
        currentOrg.id,
        fromDate ? new Date(fromDate).toISOString() : undefined,
        toDate ? new Date(toDate).toISOString() : undefined,
      );
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `audit-log-${currentOrg.id}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Export failed');
    }
  }, [currentOrg, fromDate, toDate]);

  const handleFilterApply = useCallback(() => {
    setPage(0);
    load();
  }, [load]);

  const totalPages = Math.ceil(total / PAGE_SIZE);

  if (!currentOrg) return <div className="audit-log-page"><p>Select an organization</p></div>;

  return (
    <div className="audit-log-page">
      <h2>Audit Log</h2>

      {/* Filters */}
      <section className="audit-filters" data-testid="audit-filters">
        <select
          value={actionFilter}
          onChange={(e) => setActionFilter(e.target.value)}
          data-testid="action-filter"
          aria-label="Filter by action"
        >
          <option value="">All Actions</option>
          {ACTION_TYPES.map((a) => (
            <option key={a} value={a}>{a}</option>
          ))}
        </select>

        <input
          type="text"
          placeholder="Actor ID"
          value={actorFilter}
          onChange={(e) => setActorFilter(e.target.value)}
          data-testid="actor-filter"
          aria-label="Filter by actor"
        />

        <input
          type="date"
          value={fromDate}
          onChange={(e) => setFromDate(e.target.value)}
          data-testid="from-date"
          aria-label="From date"
        />

        <input
          type="date"
          value={toDate}
          onChange={(e) => setToDate(e.target.value)}
          data-testid="to-date"
          aria-label="To date"
        />

        <button onClick={handleFilterApply} data-testid="apply-filters-btn">
          Apply Filters
        </button>

        <button onClick={handleExport} data-testid="export-btn">
          Export JSON
        </button>
      </section>

      {error && <p className="error" role="alert">{error}</p>}

      {/* Results Table */}
      {loading ? (
        <p>Loading audit log...</p>
      ) : entries.length === 0 ? (
        <p data-testid="empty-state">No audit log entries found.</p>
      ) : (
        <>
          <table data-testid="audit-table">
            <thead>
              <tr>
                <th>Time</th>
                <th>Action</th>
                <th>Actor</th>
                <th>Resource</th>
                <th>Result</th>
                <th>IP</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => (
                <tr key={entry.id} data-testid="audit-row">
                  <td>{formatDateTime(entry.created_at)}</td>
                  <td>{entry.action}</td>
                  <td>{entry.actor_id} ({entry.actor_type})</td>
                  <td>{entry.resource_type}{entry.resource_id ? `: ${entry.resource_id}` : ''}</td>
                  <td className={`result-${entry.result}`}>{entry.result}</td>
                  <td>{entry.ip_address ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* Pagination */}
          <div className="pagination" data-testid="pagination">
            <button
              disabled={page === 0}
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              data-testid="prev-page"
            >
              ← Previous
            </button>
            <span>Page {page + 1} of {totalPages} ({total} entries)</span>
            <button
              disabled={page >= totalPages - 1}
              onClick={() => setPage((p) => p + 1)}
              data-testid="next-page"
            >
              Next →
            </button>
          </div>
        </>
      )}
    </div>
  );
}

export default AuditLogPage;
