import React from 'react';

export default function SharingActivity() {
  return (
    <div className="p-6 max-w-2xl mx-auto">
      <h1 className="text-2xl font-bold text-gray-900 mb-4">Sharing Activity</h1>
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-6">
        <h2 className="text-lg font-semibold text-blue-800 mb-2">
          ✨ Moved to Lore
        </h2>
        <p className="text-blue-700 mb-4">
          Sharing activity and audit logs are now tracked by{' '}
          <strong>Lore</strong>, the dedicated memory service in the AgentKit ecosystem.
        </p>
        <p className="text-blue-600 text-sm">
          Lesson creation, search, and usage activity is available through the Lore API.
        </p>
      </div>
    </div>
  );
}
