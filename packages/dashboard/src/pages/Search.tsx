import React, { useState, useCallback } from 'react';
import { recall, type RecallResultItem } from '../api/client';

const SCOPE_OPTIONS = [
  { value: '', label: 'All' },
  { value: 'event', label: 'Events' },
  { value: 'session', label: 'Sessions' },
  { value: 'lesson', label: 'Lessons' },
];

function formatTimestamp(ts?: string): string {
  if (!ts) return '';
  try {
    return new Date(ts).toLocaleString();
  } catch {
    return ts;
  }
}

function sourceTypeBadge(type: string): string {
  switch (type) {
    case 'event':
      return 'bg-blue-100 text-blue-700';
    case 'session':
      return 'bg-green-100 text-green-700';
    case 'lesson':
      return 'bg-purple-100 text-purple-700';
    default:
      return 'bg-gray-100 text-gray-700';
  }
}

export function Search(): React.ReactElement {
  const [query, setQuery] = useState('');
  const [scope, setScope] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [results, setResults] = useState<RecallResultItem[]>([]);
  const [totalResults, setTotalResults] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searched, setSearched] = useState(false);

  const handleSearch = useCallback(
    async (e?: React.FormEvent) => {
      e?.preventDefault();
      if (!query.trim()) return;

      setLoading(true);
      setError(null);
      setSearched(true);

      try {
        const result = await recall({
          query: query.trim(),
          scope: scope || undefined,
          from: from || undefined,
          to: to || undefined,
          limit: 20,
        });
        setResults(result.results);
        setTotalResults(result.totalResults);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Search failed');
        setResults([]);
        setTotalResults(0);
      } finally {
        setLoading(false);
      }
    },
    [query, scope, from, to],
  );

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-gray-900">Semantic Search</h1>

      <form onSubmit={handleSearch} className="space-y-3">
        <div className="flex gap-3">
          <input
            type="text"
            placeholder="Search across events, sessions, and lessons..."
            className="flex-1 rounded-md border border-gray-300 px-4 py-2.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <button
            type="submit"
            disabled={loading || !query.trim()}
            className="rounded-md bg-blue-600 px-6 py-2.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {loading ? 'Searching...' : 'Search'}
          </button>
        </div>

        <div className="flex flex-wrap gap-3">
          <select
            className="rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            value={scope}
            onChange={(e) => setScope(e.target.value)}
          >
            {SCOPE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
          <input
            type="date"
            className="rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            placeholder="From"
          />
          <input
            type="date"
            className="rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            placeholder="To"
          />
        </div>
      </form>

      {error && (
        <div className="rounded-md bg-red-50 p-3 text-sm text-red-700">{error}</div>
      )}

      {searched && !loading && (
        <div className="text-sm text-gray-500">
          {totalResults} result{totalResults !== 1 ? 's' : ''} found
        </div>
      )}

      <div className="space-y-3">
        {results.map((item, idx) => (
          <div
            key={`${item.sourceId}-${idx}`}
            className="rounded-lg border border-gray-200 bg-white p-4 hover:shadow-sm transition-shadow"
          >
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <span
                  className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${sourceTypeBadge(item.sourceType)}`}
                >
                  {item.sourceType}
                </span>
                <span className="text-xs text-gray-400 font-mono">
                  {item.sourceId}
                </span>
              </div>
              <div className="flex items-center gap-2">
                {typeof item.metadata?.timestamp === 'string' && (
                  <span className="text-xs text-gray-400">
                    {formatTimestamp(item.metadata.timestamp)}
                  </span>
                )}
              </div>
            </div>
            <p className="text-sm text-gray-700 mb-2">{item.text}</p>
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-500">Score:</span>
              <div className="flex-1 max-w-[200px] h-2 bg-gray-100 rounded-full overflow-hidden">
                <div
                  className="h-full bg-blue-500 rounded-full"
                  style={{ width: `${Math.round(item.score * 100)}%` }}
                />
              </div>
              <span className="text-xs text-gray-500 font-mono">
                {(item.score * 100).toFixed(1)}%
              </span>
            </div>
          </div>
        ))}
      </div>

      {searched && !loading && results.length === 0 && !error && (
        <div className="py-12 text-center">
          <div className="text-4xl mb-3">🔍</div>
          <p className="text-gray-500">No results found. Try a different query.</p>
        </div>
      )}
    </div>
  );
}
