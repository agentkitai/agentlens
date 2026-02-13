import React from 'react';

export default function SharingControls() {
  return (
    <div className="p-6 max-w-2xl mx-auto">
      <h1 className="text-2xl font-bold text-gray-900 mb-4">Sharing Controls</h1>
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-6">
        <h2 className="text-lg font-semibold text-blue-800 mb-2">
          ✨ Moved to Lore
        </h2>
        <p className="text-blue-700 mb-4">
          Community sharing and lesson management is now handled by{' '}
          <strong>Lore</strong>, the dedicated memory service in the AgentKit ecosystem.
        </p>
        <p className="text-blue-600 text-sm">
          Use the <strong>Lessons</strong> page to browse, create, and search lessons stored in Lore.
          For sharing configuration, use the Lore API directly.
        </p>
      </div>
    </div>
  );
}
