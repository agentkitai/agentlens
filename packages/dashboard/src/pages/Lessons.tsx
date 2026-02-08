import React, { useState, useCallback } from 'react';
import { useApi } from '../hooks/useApi';
import {
  getLessons,
  createLesson,
  updateLesson,
  deleteLesson,
  type LessonData,
  type CreateLessonData,
  type LessonImportance,
} from '../api/client';
import { LessonEditor } from '../components/LessonEditor';
import { LessonList } from '../components/LessonList';

const IMPORTANCE_FILTERS: { value: string; label: string }[] = [
  { value: '', label: 'All' },
  { value: 'critical', label: 'Critical' },
  { value: 'high', label: 'High' },
  { value: 'normal', label: 'Normal' },
  { value: 'low', label: 'Low' },
];

export function Lessons(): React.ReactElement {
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [importanceFilter, setImportanceFilter] = useState('');
  const [showEditor, setShowEditor] = useState(false);
  const [editingLesson, setEditingLesson] = useState<LessonData | null>(null);
  const [saving, setSaving] = useState(false);

  const lessons = useApi(
    () =>
      getLessons({
        search: search || undefined,
        category: categoryFilter || undefined,
        importance: (importanceFilter || undefined) as LessonImportance | undefined,
        limit: 50,
      }),
    [search, categoryFilter, importanceFilter],
  );

  // Extract unique categories from lessons
  const categories = Array.from(
    new Set((lessons.data?.lessons ?? []).map((l) => l.category).filter(Boolean)),
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

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Lessons</h1>
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

      {/* Filters */}
      <div className="flex flex-col md:flex-row gap-3">
        <input
          type="text"
          placeholder="Search lessons..."
          className="flex-1 rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select
          className="rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          value={categoryFilter}
          onChange={(e) => setCategoryFilter(e.target.value)}
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
      </div>

      {/* List */}
      <div className="rounded-lg border border-gray-200 bg-white overflow-hidden">
        {lessons.loading ? (
          <div className="py-12 text-center text-gray-500">Loading lessons...</div>
        ) : lessons.error ? (
          <div className="py-12 text-center text-red-500">Error: {lessons.error}</div>
        ) : (
          <>
            <div className="px-4 py-2 border-b border-gray-200 bg-gray-50 text-xs text-gray-500">
              {lessons.data?.total ?? 0} lesson(s)
            </div>
            <LessonList
              lessons={lessons.data?.lessons ?? []}
              onEdit={handleEdit}
              onDelete={handleDelete}
            />
          </>
        )}
      </div>
    </div>
  );
}
