import React, { useState, useCallback } from 'react';
import { useApi } from '../hooks/useApi';
import {
  getLessons,
  createLesson,
  updateLesson,
  deleteLesson,
  communityRate,
  type LessonData,
  type CreateLessonData,
  type LessonImportance,
} from '../api/client';
import { LessonEditor } from '../components/LessonEditor';

const IMPORTANCE_FILTERS: { value: string; label: string }[] = [
  { value: '', label: 'All Importance' },
  { value: 'critical', label: 'Critical' },
  { value: 'high', label: 'High' },
  { value: 'normal', label: 'Normal' },
  { value: 'low', label: 'Low' },
];

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

export function Knowledge(): React.ReactElement {
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [importanceFilter, setImportanceFilter] = useState('');
  const [agentFilter, setAgentFilter] = useState('');
  const [showEditor, setShowEditor] = useState(false);
  const [editingLesson, setEditingLesson] = useState<LessonData | null>(null);
  const [saving, setSaving] = useState(false);
  const [ratingInFlight, setRatingInFlight] = useState<string | null>(null);

  const lessons = useApi(
    () =>
      getLessons({
        search: search || undefined,
        category: categoryFilter || undefined,
        importance: (importanceFilter || undefined) as LessonImportance | undefined,
        agentId: agentFilter || undefined,
        limit: 50,
      }),
    [search, categoryFilter, importanceFilter, agentFilter],
  );

  const allLessons = lessons.data?.lessons ?? [];

  // Extract unique categories and agents for filter dropdowns
  const categories = Array.from(
    new Set(allLessons.map((l) => l.category).filter(Boolean)),
  ).sort();
  const agents = Array.from(
    new Set(allLessons.map((l) => l.agentId).filter(Boolean) as string[]),
  ).sort();

  const handleCreate = useCallback(
    async (data: CreateLessonData) => {
      setSaving(true);
      try {
        await createLesson(data);
        setShowEditor(false);
        lessons.refetch();
      } finally {
        setSaving(false);
      }
    },
    [lessons],
  );

  const handleUpdate = useCallback(
    async (data: CreateLessonData) => {
      if (!editingLesson) return;
      setSaving(true);
      try {
        await updateLesson(editingLesson.id, data);
        setEditingLesson(null);
        setShowEditor(false);
        lessons.refetch();
      } finally {
        setSaving(false);
      }
    },
    [editingLesson, lessons],
  );

  const handleEdit = useCallback((lesson: LessonData) => {
    setEditingLesson(lesson);
    setShowEditor(true);
  }, []);

  const handleDelete = useCallback(
    async (id: string) => {
      if (!confirm('Archive this lesson?')) return;
      try {
        await deleteLesson(id);
        lessons.refetch();
      } catch (err) {
        console.error('Failed to archive lesson:', err);
      }
    },
    [lessons],
  );

  const handleCancel = useCallback(() => {
    setShowEditor(false);
    setEditingLesson(null);
  }, []);

  const handleRate = useCallback(
    async (lessonId: string, delta: number) => {
      setRatingInFlight(lessonId);
      try {
        await communityRate(lessonId, delta);
        lessons.refetch();
      } catch (err) {
        console.error('Failed to rate lesson:', err);
      } finally {
        setRatingInFlight(null);
      }
    },
    [lessons],
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Knowledge</h1>
          <p className="text-sm text-gray-500 mt-1">
            Browse, create, and rate lessons learned by your agents
          </p>
        </div>
        <button
          onClick={() => {
            setEditingLesson(null);
            setShowEditor(!showEditor);
          }}
          className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
        >
          {showEditor && !editingLesson ? 'Cancel' : '+ New Lesson'}
        </button>
      </div>

      {/* Editor */}
      {showEditor && (
        <LessonEditor
          lesson={editingLesson}
          onSave={editingLesson ? handleUpdate : handleCreate}
          onCancel={handleCancel}
          saving={saving}
        />
      )}

      {/* Search & Filters */}
      <div className="rounded-lg border border-gray-200 bg-white p-4 space-y-3">
        <div className="flex flex-col md:flex-row gap-3">
          <input
            type="text"
            placeholder="Search lessons..."
            className="flex-1 rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            data-testid="search-input"
          />
          <select
            className="rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            data-testid="category-filter"
          >
            <option value="">All Categories</option>
            {categories.map((cat) => (
              <option key={cat} value={cat}>
                {cat}
              </option>
            ))}
          </select>
          <select
            className="rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            value={importanceFilter}
            onChange={(e) => setImportanceFilter(e.target.value)}
          >
            {IMPORTANCE_FILTERS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
          {agents.length > 0 && (
            <select
              className="rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              value={agentFilter}
              onChange={(e) => setAgentFilter(e.target.value)}
            >
              <option value="">All Agents</option>
              {agents.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </select>
          )}
        </div>
      </div>

      {/* Results */}
      <div className="rounded-lg border border-gray-200 bg-white overflow-hidden">
        {lessons.loading ? (
          <div className="py-12 text-center text-gray-500">Loading...</div>
        ) : lessons.error ? (
          <div className="py-12 text-center text-red-500">Error: {lessons.error}</div>
        ) : allLessons.length === 0 ? (
          <div className="py-12 text-center">
            <div className="text-4xl mb-3">🧠</div>
            <p className="text-gray-500">No lessons found. Try a different search or create one.</p>
          </div>
        ) : (
          <>
            <div className="px-4 py-2 border-b border-gray-200 bg-gray-50 text-xs text-gray-500">
              {lessons.data?.total ?? 0} lesson(s)
            </div>
            <div className="divide-y divide-gray-200">
              {allLessons.map((lesson) => (
                <div
                  key={lesson.id}
                  className="flex items-start justify-between gap-4 py-4 px-4 hover:bg-gray-50 transition-colors"
                  data-testid={`lesson-${lesson.id}`}
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
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
                      {lesson.agentId && (
                        <span className="inline-flex items-center rounded-full bg-green-50 px-2 py-0.5 text-xs font-medium text-green-700">
                          🤖 {lesson.agentId}
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
                    {/* Rating buttons */}
                    <button
                      onClick={() => handleRate(lesson.id, 1)}
                      disabled={ratingInFlight === lesson.id}
                      className="px-2 py-1 text-sm border border-gray-200 rounded hover:bg-green-50 disabled:opacity-50"
                      title="Upvote"
                      data-testid={`rate-up-${lesson.id}`}
                    >
                      👍
                    </button>
                    <button
                      onClick={() => handleRate(lesson.id, -1)}
                      disabled={ratingInFlight === lesson.id}
                      className="px-2 py-1 text-sm border border-gray-200 rounded hover:bg-red-50 disabled:opacity-50"
                      title="Downvote"
                      data-testid={`rate-down-${lesson.id}`}
                    >
                      👎
                    </button>
                    {/* Edit / Archive */}
                    <button
                      onClick={() => handleEdit(lesson)}
                      className="text-sm text-blue-600 hover:text-blue-800"
                    >
                      Edit
                    </button>
                    {!lesson.archivedAt && (
                      <button
                        onClick={() => handleDelete(lesson.id)}
                        className="text-sm text-red-600 hover:text-red-800"
                      >
                        Archive
                      </button>
                    )}
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
