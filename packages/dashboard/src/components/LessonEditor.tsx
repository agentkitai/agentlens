import React, { useState, useEffect } from 'react';
import type { LessonData, CreateLessonData, LessonImportance } from '../api/client';

const IMPORTANCE_OPTIONS: { value: LessonImportance; label: string; color: string }[] = [
  { value: 'low', label: 'Low', color: 'bg-gray-100 text-gray-700' },
  { value: 'normal', label: 'Normal', color: 'bg-blue-100 text-blue-700' },
  { value: 'high', label: 'High', color: 'bg-orange-100 text-orange-700' },
  { value: 'critical', label: 'Critical', color: 'bg-red-100 text-red-700' },
];

interface LessonEditorProps {
  lesson?: LessonData | null;
  onSave: (data: CreateLessonData) => Promise<void>;
  onCancel: () => void;
  saving?: boolean;
}

export function LessonEditor({ lesson, onSave, onCancel, saving }: LessonEditorProps): React.ReactElement {
  const [title, setTitle] = useState(lesson?.title ?? '');
  const [content, setContent] = useState(lesson?.content ?? '');
  const [category, setCategory] = useState(lesson?.category ?? '');
  const [importance, setImportance] = useState<LessonImportance>(lesson?.importance ?? 'normal');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (lesson) {
      setTitle(lesson.title);
      setContent(lesson.content);
      setCategory(lesson.category);
      setImportance(lesson.importance);
    }
  }, [lesson]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      await onSave({
        title,
        content,
        category: category || undefined,
        importance,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save');
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4 rounded-lg border border-gray-200 bg-white p-6">
      <h3 className="text-lg font-semibold text-gray-900">
        {lesson ? 'Edit Lesson' : 'Create Lesson'}
      </h3>

      {error && (
        <div className="rounded-md bg-red-50 p-3 text-sm text-red-700">{error}</div>
      )}

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Title</label>
        <input
          type="text"
          required
          className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="e.g., Always retry on timeout"
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Content</label>
        <textarea
          required
          rows={4}
          className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder="Describe the lesson or insight..."
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Category</label>
          <input
            type="text"
            className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            placeholder="e.g., error-handling, deployment"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Importance</label>
          <select
            className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            value={importance}
            onChange={(e) => setImportance(e.target.value as LessonImportance)}
          >
            {IMPORTANCE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="flex gap-3 pt-2">
        <button
          type="submit"
          disabled={saving}
          className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {saving ? 'Saving...' : lesson ? 'Update' : 'Create'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
