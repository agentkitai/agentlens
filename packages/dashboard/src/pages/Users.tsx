/**
 * End-users analytics (#149)
 *
 * Route: /users
 *
 * Per end-user (metadata.userId) cost/usage breakdown with a single-user
 * drill-down. Users are attributed from event metadata (SDK-supplied or verified).
 */
import React, { useState } from 'react';
import { useApi } from '../hooks/useApi';
import { getUserAnalytics, type UserAnalytics } from '../api/analytics';

export function Users(): React.ReactElement {
  const [selected, setSelected] = useState<string | undefined>(undefined);
  const { data, loading, error } = useApi(() => getUserAnalytics({ userId: selected }), [selected]);
  const users: UserAnalytics[] = data?.users ?? [];

  return (
    <div className="max-w-5xl mx-auto p-6">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">End users</h1>
          <p className="text-sm text-gray-500 mt-1">Cost and usage attributed to each end-user over the last 30 days.</p>
        </div>
        {selected && (
          <button onClick={() => setSelected(undefined)} className="text-sm text-blue-600 hover:underline">
            ← All users
          </button>
        )}
      </div>

      {loading && <div className="text-gray-500">Loading…</div>}
      {error && <div className="text-red-600">Failed to load: {error}</div>}

      {!loading && !error && users.length === 0 && (
        <div className="border border-dashed border-gray-300 rounded-lg p-8 text-center text-gray-500">
          No end-user attribution yet. Set <code>metadata.userId</code> on your events (SDK) to see per-user cost here.
        </div>
      )}

      {users.length > 0 && (
        <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-500 text-xs uppercase">
              <tr>
                <th className="text-left px-4 py-2">User</th>
                <th className="text-right px-4 py-2">Cost</th>
                <th className="text-right px-4 py-2">Sessions</th>
                <th className="text-right px-4 py-2">Events</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {users.map((u) => (
                <tr
                  key={u.userId}
                  onClick={() => setSelected(u.userId)}
                  className="hover:bg-gray-50 cursor-pointer"
                >
                  <td className="px-4 py-2 font-medium text-gray-900">{u.userId}</td>
                  <td className="px-4 py-2 text-right">${u.totalCostUsd.toFixed(4)}</td>
                  <td className="px-4 py-2 text-right">{u.sessionCount}</td>
                  <td className="px-4 py-2 text-right">{u.eventCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default Users;
