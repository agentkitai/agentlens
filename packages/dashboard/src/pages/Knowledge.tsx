import React, { useState } from 'react';
import { useApi } from '../hooks/useApi';
import { getMemories, type LoreMemory } from '../api/lore';

const TYPE_BADGE: Record<string, string> = {
  lesson: 'bg-blue-100 text-blue-700',
  code: 'bg-purple-100 text-purple-700',
  general: 'bg-gray-100 text-gray-700',
};

function formatDate(ts: string): string {
  try {
    return new Date(ts).toLocaleDateString();
  } catch {
    return ts;
  }
}

export function Knowledge(): React.ReactElement {
  const [search, setSearch] = useState('');

  const memories = useApi(
    () => getMemories({ search: search || undefined, limit: 50 }),
    [search],
  );

  const allMemories = memories.data?.memories ?? [];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Memories</h1>
        <p className="text-sm text-gray-500 mt-1">
          Read-only view of lessons stored in Lore. Manage memories via the Lore MCP server.
        </p>
      </div>

      {/* Info banner */}
      <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-blue-800">
        Memories are managed by Lore. Use the Lore MCP tools (<code>remember</code>, <code>forget</code>) to create or delete memories.
      </div>

      {/* Search */}
      <div className="rounded-lg border border-gray-200 bg-white p-4">
        <input
          type="text"
          placeholder="Search memories..."
          className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          data-testid="search-input"
        />
      </div>

      {/* Results */}
      <div className="rounded-lg border border-gray-200 bg-white overflow-hidden">
        {memories.loading ? (
          <div className="py-12 text-center text-gray-500">Loading...</div>
        ) : memories.error ? (
          <div className="py-12 text-center text-red-500">
            <p className="text-lg mb-2">Unable to load memories</p>
            <p className="text-sm text-red-400">{memories.error}</p>
          </div>
        ) : allMemories.length === 0 ? (
          <div className="py-12 text-center">
            <div className="text-4xl mb-3">🧠</div>
            <p className="text-gray-500">No memories found. Use Lore MCP tools to create memories.</p>
          </div>
        ) : (
          <>
            <div className="px-4 py-2 border-b border-gray-200 bg-gray-50 text-xs text-gray-500">
              {memories.data?.total ?? 0} memory(ies)
            </div>
            <div className="divide-y divide-gray-200">
              {allMemories.map((memory: LoreMemory) => (
                <div
                  key={memory.id}
                  className="py-4 px-4 hover:bg-gray-50 transition-colors"
                  data-testid={`memory-${memory.id}`}
                >
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <span
                      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                        TYPE_BADGE[memory.type] ?? TYPE_BADGE.general
                      }`}
                    >
                      {memory.type}
                    </span>
                    {memory.tags.map((tag) => (
                      <span
                        key={tag}
                        className="inline-flex items-center rounded-full bg-green-50 px-2 py-0.5 text-xs font-medium text-green-700"
                      >
                        {tag}
                      </span>
                    ))}
                    {memory.source && (
                      <span className="text-xs text-gray-400">from {memory.source}</span>
                    )}
                  </div>
                  <p className="text-sm text-gray-900">{memory.content}</p>
                  {memory.metadata?._resolution && (
                    <p className="text-sm text-gray-500 mt-1 italic">
                      Resolution: {String(memory.metadata._resolution)}
                    </p>
                  )}
                  <div className="flex items-center gap-4 mt-1 text-xs text-gray-400">
                    <span>Created {formatDate(memory.createdAt)}</span>
                    <span>Confidence: {Math.round(memory.confidence * 100)}%</span>
                    {memory.upvotes > 0 && <span>+{memory.upvotes}</span>}
                    {memory.downvotes > 0 && <span>-{memory.downvotes}</span>}
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
