/**
 * Annotation Queues list (#146)
 *
 * Route: /review
 *
 * Lists human-scoring queues (the reviewer workflow on top of the existing
 * /api/annotations backend) and links into the keyboard-driven review screen.
 */
import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useApi } from '../hooks/useApi';
import { listQueues } from '../api/annotations';
import type { AnnotationQueue } from '../api/annotations';

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  } catch {
    return iso;
  }
}

export function AnnotationQueues(): React.ReactElement {
  const navigate = useNavigate();
  const { data, loading, error } = useApi(() => listQueues(), []);
  const queues: AnnotationQueue[] = data?.queues ?? [];

  return (
    <div className="max-w-5xl mx-auto p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-gray-900">Review</h1>
        <p className="text-sm text-gray-500 mt-1">
          Human-scoring queues. Open a queue to review and score items; scores attach to the session and the
          tamper-evident trail.
        </p>
      </div>

      {loading && <div className="text-gray-500">Loading queues…</div>}
      {error && <div className="text-red-600">Failed to load queues: {error}</div>}

      {!loading && !error && queues.length === 0 && (
        <div className="border border-dashed border-gray-300 rounded-lg p-8 text-center text-gray-500">
          No annotation queues yet. Create one via the API (<code>POST /api/annotations/queues</code>) and add
          sessions to review.
        </div>
      )}

      {queues.length > 0 && (
        <div className="bg-white border border-gray-200 rounded-lg divide-y divide-gray-100">
          {queues.map((q) => (
            <button
              key={q.id}
              onClick={() => navigate(`/review/${q.id}`)}
              className="w-full text-left px-4 py-3 hover:bg-gray-50 flex items-center justify-between"
            >
              <div>
                <div className="font-medium text-gray-900">{q.name}</div>
                {q.description && <div className="text-sm text-gray-500 mt-0.5">{q.description}</div>}
              </div>
              <div className="text-xs text-gray-400">created {formatDate(q.createdAt)}</div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default AnnotationQueues;
