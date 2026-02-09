/**
 * DLQ Dashboard Page (S-3.6)
 *
 * Shows dead-letter queue depth, entries with error metadata,
 * and allows manual inspection and replay of failed events.
 */

import React, { useState, useCallback, useEffect } from 'react';
import { useOrg } from './OrgContext';
import {
  getDlqHealth,
  listDlqEntries,
  replayDlqEntry,
  replayDlqBatch,
  type DlqEntry,
  type DlqHealth,
} from './api';

// ═══════════════════════════════════════════
// DLQ Dashboard Component
// ═══════════════════════════════════════════

export function DlqDashboard() {
  const { org } = useOrg();
  const [health, setHealth] = useState<DlqHealth | null>(null);
  const [entries, setEntries] = useState<DlqEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [replaying, setReplaying] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!org) return;
    setLoading(true);
    setError(null);
    try {
      const [h, e] = await Promise.all([
        getDlqHealth(org.id),
        listDlqEntries(org.id, 100),
      ]);
      setHealth(h);
      setEntries(e);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load DLQ data');
    } finally {
      setLoading(false);
    }
  }, [org]);

  useEffect(() => { load(); }, [load]);

  const handleReplaySingle = useCallback(async (streamId: string) => {
    if (!org) return;
    setReplaying(true);
    try {
      await replayDlqEntry(org.id, streamId);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Replay failed');
    } finally {
      setReplaying(false);
    }
  }, [org, load]);

  const handleReplaySelected = useCallback(async () => {
    if (!org || selected.size === 0) return;
    setReplaying(true);
    try {
      const result = await replayDlqBatch(org.id, Array.from(selected));
      setSelected(new Set());
      if (result.failed > 0) {
        setError(`Replayed ${result.replayed}, failed ${result.failed}: ${result.errors.join(', ')}`);
      }
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Batch replay failed');
    } finally {
      setReplaying(false);
    }
  }, [org, selected, load]);

  const toggleSelect = (streamId: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(streamId)) next.delete(streamId);
      else next.add(streamId);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selected.size === entries.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(entries.map((e) => e.streamId)));
    }
  };

  if (!org) return <div className="p-4 text-gray-500">Select an organization</div>;

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Dead Letter Queue</h1>
        <button
          onClick={load}
          disabled={loading}
          className="px-3 py-1.5 text-sm bg-gray-100 rounded hover:bg-gray-200 disabled:opacity-50"
        >
          {loading ? 'Loading...' : 'Refresh'}
        </button>
      </div>

      {/* Health Banner */}
      {health && (
        <div className={`rounded-lg p-4 mb-6 ${
          health.dlqHealthy ? 'bg-green-50 border border-green-200' : 'bg-red-50 border border-red-200'
        }`}>
          <div className="flex items-center justify-between">
            <div>
              <span className="text-lg font-semibold">
                {health.dlqDepth === 0 ? '✅ DLQ Empty' : `⚠️ ${health.dlqDepth} events in DLQ`}
              </span>
              {health.dlqWarning && (
                <p className="text-sm text-red-600 mt-1">{health.dlqWarning}</p>
              )}
            </div>
            {selected.size > 0 && (
              <button
                onClick={handleReplaySelected}
                disabled={replaying}
                className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
              >
                {replaying ? 'Replaying...' : `Replay ${selected.size} selected`}
              </button>
            )}
          </div>
        </div>
      )}

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-3 mb-4 text-red-700 text-sm">
          {error}
          <button onClick={() => setError(null)} className="ml-2 underline">dismiss</button>
        </div>
      )}

      {/* Entry Table */}
      {entries.length === 0 && !loading ? (
        <div className="text-center text-gray-500 py-12">
          No events in the dead letter queue. All clear! 🎉
        </div>
      ) : (
        <div className="border rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="p-3 text-left w-8">
                  <input
                    type="checkbox"
                    checked={selected.size === entries.length && entries.length > 0}
                    onChange={toggleSelectAll}
                  />
                </th>
                <th className="p-3 text-left">Event ID</th>
                <th className="p-3 text-left">Type</th>
                <th className="p-3 text-left">Reason</th>
                <th className="p-3 text-left">DLQ Time</th>
                <th className="p-3 text-left w-24">Actions</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => (
                <React.Fragment key={entry.streamId}>
                  <tr
                    className="border-t hover:bg-gray-50 cursor-pointer"
                    onClick={() => setExpandedId(expandedId === entry.streamId ? null : entry.streamId)}
                  >
                    <td className="p-3" onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        checked={selected.has(entry.streamId)}
                        onChange={() => toggleSelect(entry.streamId)}
                      />
                    </td>
                    <td className="p-3 font-mono text-xs">{entry.event.id}</td>
                    <td className="p-3">
                      <span className="px-2 py-0.5 bg-gray-100 rounded text-xs">
                        {entry.event.type}
                      </span>
                    </td>
                    <td className="p-3 text-red-600">{entry.dlqReason}</td>
                    <td className="p-3 text-gray-500">
                      {entry.dlqTimestamp ? new Date(entry.dlqTimestamp).toLocaleString() : '—'}
                    </td>
                    <td className="p-3" onClick={(e) => e.stopPropagation()}>
                      <button
                        onClick={() => handleReplaySingle(entry.streamId)}
                        disabled={replaying}
                        className="px-2 py-1 text-xs bg-blue-100 text-blue-700 rounded hover:bg-blue-200 disabled:opacity-50"
                      >
                        Replay
                      </button>
                    </td>
                  </tr>
                  {expandedId === entry.streamId && (
                    <tr className="border-t bg-gray-50">
                      <td colSpan={6} className="p-4">
                        <pre className="text-xs bg-white p-3 rounded border overflow-auto max-h-64">
                          {JSON.stringify(entry.event, null, 2)}
                        </pre>
                        <div className="mt-2 text-xs text-gray-500">
                          Stream ID: {entry.streamId} | Original: {entry.originalStreamId}
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
