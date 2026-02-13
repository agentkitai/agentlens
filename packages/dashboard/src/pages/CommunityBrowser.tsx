import React from 'react';

export default function CommunityBrowser() {
  return (
    <div className="p-6 max-w-2xl mx-auto">
      <h1 className="text-2xl font-bold text-gray-900 mb-4">Community</h1>
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-6">
        <h2 className="text-lg font-semibold text-blue-800 mb-2">
          ✨ Moved to Lore
        </h2>
        <p className="text-blue-700 mb-4">
          Community lesson browsing and sharing is now powered by{' '}
          <strong>Lore</strong>, the dedicated memory service in the AgentKit ecosystem.
        </p>
        <p className="text-blue-600 text-sm">
          Use the <strong>Lessons</strong> page to search and browse lessons.
          Semantic search is available when embeddings are enabled.
        </p>
      </div>
    </div>
  );
}
