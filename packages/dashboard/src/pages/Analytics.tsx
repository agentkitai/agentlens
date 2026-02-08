import React from 'react';

export function Analytics(): React.ReactElement {
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-gray-900">Analytics</h1>
      <div className="rounded-lg border border-gray-200 bg-white py-16 text-center">
        <div className="text-4xl mb-4">📊</div>
        <h2 className="text-lg font-semibold text-gray-700">Coming Soon</h2>
        <p className="mt-2 text-sm text-gray-500 max-w-md mx-auto">
          Aggregated metrics, trends, and insights across your agents will be available here.
        </p>
      </div>
    </div>
  );
}
