import React from 'react';
import type { LessonData, LessonImportance } from '../api/client';

const IMPORTANCE_BADGE: Record<LessonImportance, string> = {
  low: 'bg-gray-100 text-gray-700',
  normal: 'bg-blue-100 text-blue-700',
  high: 'bg-orange-100 text-orange-700',
  critical: 'bg-red-100 text-red-700',
};

function formatDate(ts: string): string {
  try {
    return new Date(ts).toLocaleDateString();
  } catch {
    return ts;
  }
}

interface LessonListProps {
  lessons: LessonData[];
  onEdit: (lesson: LessonData) => void;
  onDelete: (id: string) => void;
}

export function LessonList({ lessons, onEdit, onDelete }: LessonListProps): React.ReactElement {
  if (lessons.length === 0) {
    return (
      <div className="py-12 text-center">
        <div className="text-4xl mb-3">📚</div>
        <p className="text-gray-500">No lessons found.</p>
      </div>
    );
  }

  return (
    <div className="divide-y divide-gray-200">
      {lessons.map((lesson) => (
        <div
          key={lesson.id}
          className="flex items-start justify-between gap-4 py-4 px-4 hover:bg-gray-50 transition-colors"
        >
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <h3 className="text-sm font-medium text-gray-900 truncate">
                {lesson.title}
              </h3>
              <span
                className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                  IMPORTANCE_BADGE[lesson.importance]
                }`}
              >
                {lesson.importance}
              </span>
              {lesson.category && (
                <span className="inline-flex items-center rounded-full bg-purple-50 px-2 py-0.5 text-xs font-medium text-purple-700">
                  {lesson.category}
                </span>
              )}
            </div>
            <p className="text-sm text-gray-600 line-clamp-2">{lesson.content}</p>
            <div className="flex items-center gap-4 mt-1 text-xs text-gray-400">
              <span>Created {formatDate(lesson.createdAt)}</span>
              <span>Accessed {lesson.accessCount}×</span>
              {lesson.archivedAt && (
                <span className="text-red-400">Archived</span>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <button
              onClick={() => onEdit(lesson)}
              className="text-sm text-blue-600 hover:text-blue-800"
            >
              Edit
            </button>
            {!lesson.archivedAt && (
              <button
                onClick={() => onDelete(lesson.id)}
                className="text-sm text-red-600 hover:text-red-800"
              >
                Archive
              </button>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
