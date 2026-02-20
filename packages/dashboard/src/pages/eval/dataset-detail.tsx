/**
 * Eval Dataset Detail Page (Feature 15 — Story 13)
 *
 * Route: /eval/datasets/:id
 *
 * Features:
 *  - Dataset metadata display/edit
 *  - Test case list with add/edit/delete
 *  - Create new version
 *  - Test case editor with input (prompt + context), expected output, tags, scoring criteria
 */
import React, { useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useApi } from '../../hooks/useApi';
import {
  getEvalDataset,
  updateEvalDataset,
  addTestCase,
  updateTestCase,
  deleteTestCase,
  createDatasetVersion,
} from '../../api/eval';
import type { EvalTestCase } from '../../api/eval';
import type { EvalInput } from '@agentlensai/core';

// ─── Test Case Editor ───────────────────────────────────────────────

interface TestCaseFormData {
  prompt: string;
  context: string;
  expectedOutput: string;
  tags: string;
  scoringCriteria: string;
}

const emptyForm: TestCaseFormData = {
  prompt: '',
  context: '{}',
  expectedOutput: '',
  tags: '',
  scoringCriteria: '',
};

function TestCaseEditor({
  initial,
  onSave,
  onCancel,
  saving,
}: {
  initial?: TestCaseFormData;
  onSave: (data: TestCaseFormData) => void;
  onCancel: () => void;
  saving: boolean;
}) {
  const [form, setForm] = useState<TestCaseFormData>(initial ?? emptyForm);

  const set = (key: keyof TestCaseFormData, val: string) =>
    setForm((f) => ({ ...f, [key]: val }));

  return (
    <div className="rounded-lg border border-indigo-200 bg-indigo-50/30 p-4 space-y-3">
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Prompt *</label>
        <textarea
          value={form.prompt}
          onChange={(e) => set('prompt', e.target.value)}
          rows={3}
          placeholder="The prompt to send to the agent..."
          className="w-full rounded border border-gray-300 px-3 py-2 text-sm font-mono"
        />
      </div>
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Context (JSON)</label>
        <textarea
          value={form.context}
          onChange={(e) => set('context', e.target.value)}
          rows={2}
          placeholder="{}"
          className="w-full rounded border border-gray-300 px-3 py-2 text-sm font-mono"
        />
      </div>
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Expected Output</label>
        <textarea
          value={form.expectedOutput}
          onChange={(e) => set('expectedOutput', e.target.value)}
          rows={2}
          placeholder="Expected agent response..."
          className="w-full rounded border border-gray-300 px-3 py-2 text-sm font-mono"
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Tags (comma-separated)</label>
          <input
            type="text"
            value={form.tags}
            onChange={(e) => set('tags', e.target.value)}
            placeholder="e.g., regression, happy-path"
            className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Scoring Criteria</label>
          <input
            type="text"
            value={form.scoringCriteria}
            onChange={(e) => set('scoringCriteria', e.target.value)}
            placeholder="e.g., Must mention pricing"
            className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
          />
        </div>
      </div>
      <div className="flex gap-2 justify-end">
        <button
          onClick={onCancel}
          className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
        >
          Cancel
        </button>
        <button
          onClick={() => onSave(form)}
          disabled={!form.prompt.trim() || saving}
          className="rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
        >
          {saving ? 'Saving...' : 'Save'}
        </button>
      </div>
    </div>
  );
}

function testCaseToForm(tc: EvalTestCase): TestCaseFormData {
  return {
    prompt: tc.input?.prompt ?? '',
    context: tc.input?.context ? JSON.stringify(tc.input.context, null, 2) : '{}',
    expectedOutput: tc.expectedOutput != null ? (typeof tc.expectedOutput === 'string' ? tc.expectedOutput : JSON.stringify(tc.expectedOutput, null, 2)) : '',
    tags: (tc.tags ?? []).join(', '),
    scoringCriteria: tc.scoringCriteria ?? '',
  };
}

function formToPayload(form: TestCaseFormData) {
  let context: Record<string, unknown> | undefined;
  try {
    const parsed = JSON.parse(form.context);
    if (typeof parsed === 'object' && parsed !== null) context = parsed;
  } catch { /* ignore */ }

  const input: EvalInput = { prompt: form.prompt.trim(), context };
  const tags = form.tags
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean);

  return {
    input,
    expectedOutput: form.expectedOutput.trim() || undefined,
    tags: tags.length > 0 ? tags : undefined,
    scoringCriteria: form.scoringCriteria.trim() || undefined,
  };
}

// ─── Component ──────────────────────────────────────────────────────

export function EvalDatasetDetail(): React.ReactElement {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState('');
  const [editDesc, setEditDesc] = useState('');
  const [addingCase, setAddingCase] = useState(false);
  const [editingCaseId, setEditingCaseId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [versionLoading, setVersionLoading] = useState(false);

  const { data, loading, error, refetch } = useApi(
    () => (id ? getEvalDataset(id) : Promise.reject('no id')),
    [id],
  );

  const handleUpdateMeta = useCallback(async () => {
    if (!id) return;
    setSaving(true);
    try {
      await updateEvalDataset(id, {
        name: editName.trim() || undefined,
        description: editDesc.trim() || undefined,
      });
      setEditing(false);
      refetch();
    } catch { /* */ } finally {
      setSaving(false);
    }
  }, [id, editName, editDesc, refetch]);

  const handleAddCase = useCallback(
    async (form: TestCaseFormData) => {
      if (!id) return;
      setSaving(true);
      try {
        await addTestCase(id, formToPayload(form));
        setAddingCase(false);
        refetch();
      } catch { /* */ } finally {
        setSaving(false);
      }
    },
    [id, refetch],
  );

  const handleUpdateCase = useCallback(
    async (caseId: string, form: TestCaseFormData) => {
      if (!id) return;
      setSaving(true);
      try {
        await updateTestCase(id, caseId, formToPayload(form));
        setEditingCaseId(null);
        refetch();
      } catch { /* */ } finally {
        setSaving(false);
      }
    },
    [id, refetch],
  );

  const handleDeleteCase = useCallback(
    async (caseId: string) => {
      if (!id || !confirm('Delete this test case?')) return;
      try {
        await deleteTestCase(id, caseId);
        refetch();
      } catch { /* */ }
    },
    [id, refetch],
  );

  const handleNewVersion = useCallback(async () => {
    if (!id) return;
    setVersionLoading(true);
    try {
      const newDs = await createDatasetVersion(id);
      navigate(`/eval/datasets/${newDs.id}`);
    } catch { /* */ } finally {
      setVersionLoading(false);
    }
  }, [id, navigate]);

  if (loading && !data) {
    return (
      <div className="space-y-4">
        <div className="h-8 w-48 animate-pulse rounded bg-gray-100" />
        <div className="h-32 animate-pulse rounded-xl bg-gray-100" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-4 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
        Error loading dataset: {error}
      </div>
    );
  }

  if (!data) return <div />;

  const testCases = data.testCases ?? [];

  return (
    <div className="space-y-6">
      {/* Back link */}
      <button
        onClick={() => navigate('/eval/datasets')}
        className="text-sm text-indigo-600 hover:text-indigo-800"
      >
        ← Back to Datasets
      </button>

      {/* Header */}
      <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
        {editing ? (
          <div className="space-y-3">
            <input
              type="text"
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              className="w-full rounded border border-gray-300 px-3 py-2 text-lg font-bold"
            />
            <textarea
              value={editDesc}
              onChange={(e) => setEditDesc(e.target.value)}
              rows={2}
              className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
            />
            <div className="flex gap-2">
              <button
                onClick={handleUpdateMeta}
                disabled={saving}
                className="rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
              >
                Save
              </button>
              <button
                onClick={() => setEditing(false)}
                className="rounded-lg border px-3 py-1.5 text-sm"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <div className="flex items-start justify-between">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">{data.name}</h1>
              {data.description && (
                <p className="text-sm text-gray-500 mt-1">{data.description}</p>
              )}
              <div className="flex gap-4 mt-3 text-sm text-gray-500">
                <span>Version {data.version}</span>
                {data.agentId && <span>Agent: {data.agentId}</span>}
                <span>{testCases.length} test cases</span>
                {data.immutable && (
                  <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800">
                    Immutable
                  </span>
                )}
              </div>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => {
                  setEditName(data.name);
                  setEditDesc(data.description ?? '');
                  setEditing(true);
                }}
                disabled={data.immutable}
                className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-40"
              >
                Edit
              </button>
              <button
                onClick={handleNewVersion}
                disabled={versionLoading}
                className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
              >
                {versionLoading ? 'Creating...' : 'New Version'}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Test Cases */}
      <div className="rounded-xl border border-gray-200 bg-white shadow-sm">
        <div className="flex items-center justify-between p-4 border-b border-gray-200">
          <h3 className="text-base font-semibold text-gray-900">Test Cases</h3>
          <button
            onClick={() => setAddingCase(true)}
            disabled={data.immutable}
            className="rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-40"
          >
            Add Test Case
          </button>
        </div>

        <div className="divide-y divide-gray-200">
          {addingCase && (
            <div className="p-4">
              <TestCaseEditor
                onSave={handleAddCase}
                onCancel={() => setAddingCase(false)}
                saving={saving}
              />
            </div>
          )}

          {testCases.length === 0 && !addingCase ? (
            <div className="p-8 text-center text-gray-400 text-sm">
              No test cases yet. Add your first one to get started.
            </div>
          ) : (
            testCases.map((tc, idx) => (
              <div key={tc.id} className="p-4">
                {editingCaseId === tc.id ? (
                  <TestCaseEditor
                    initial={testCaseToForm(tc)}
                    onSave={(form) => handleUpdateCase(tc.id, form)}
                    onCancel={() => setEditingCaseId(null)}
                    saving={saving}
                  />
                ) : (
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-xs font-medium text-gray-400">#{idx + 1}</span>
                        {tc.tags?.map((tag) => (
                          <span
                            key={tag}
                            className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-600"
                          >
                            {tag}
                          </span>
                        ))}
                      </div>
                      <p className="text-sm text-gray-900 font-mono truncate">
                        {tc.input?.prompt}
                      </p>
                      {tc.expectedOutput != null && (
                        <p className="text-xs text-gray-500 mt-1 truncate">
                          Expected: {typeof tc.expectedOutput === 'string' ? tc.expectedOutput : JSON.stringify(tc.expectedOutput)}
                        </p>
                      )}
                      {tc.scoringCriteria && (
                        <p className="text-xs text-gray-400 mt-0.5">
                          Scoring: {tc.scoringCriteria}
                        </p>
                      )}
                    </div>
                    <div className="flex gap-1">
                      <button
                        onClick={() => setEditingCaseId(tc.id)}
                        disabled={data.immutable}
                        className="rounded px-2 py-1 text-xs text-gray-500 hover:bg-gray-100 disabled:opacity-40"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => handleDeleteCase(tc.id)}
                        disabled={data.immutable}
                        className="rounded px-2 py-1 text-xs text-red-500 hover:bg-red-50 disabled:opacity-40"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
