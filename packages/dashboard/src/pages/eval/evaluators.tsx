/**
 * Evaluator Catalog page (#55 Phase 4). Route: /eval/evaluators
 *
 * Browse the catalog of reusable scorer definitions (built-ins + your own),
 * filter by scorer type / status / kind, create new ones, and run the
 * draft → published → verified lifecycle. Built-ins are read-only.
 */
import React, { useState, useCallback } from 'react';
import { useApi } from '../../hooks/useApi';
import {
  listEvaluators, createEvaluator, publishEvaluator, verifyEvaluator, deleteEvaluator,
} from '../../api/eval';
import type { EvaluatorDefinition, ScorerType } from '../../api/eval';

const SCORER_TYPES: ScorerType[] = ['compliance', 'llm_judge', 'regex', 'exact_match', 'contains', 'composite', 'custom'];

function placeholderConfig(t: ScorerType): string {
  if (t === 'compliance') return JSON.stringify({ rules: [{ id: 'no_delete', type: 'tool_denylist', tools: ['delete_*'] }] }, null, 2);
  if (t === 'llm_judge') return JSON.stringify({ rubric: 'Did the agent ...? Score 1.0 if compliant, 0.0 otherwise.' }, null, 2);
  if (t === 'regex') return JSON.stringify({ pattern: '^OK' }, null, 2);
  return JSON.stringify({}, null, 2);
}

function Badge({ children, color }: { children: React.ReactNode; color: string }): React.ReactElement {
  return <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${color}`}>{children}</span>;
}

export function Evaluators(): React.ReactElement {
  const [scorerType, setScorerType] = useState('');
  const [status, setStatus] = useState('');
  const [kind, setKind] = useState(''); // '' | 'builtin' | 'custom'
  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState('');
  const [type, setType] = useState<ScorerType>('compliance');
  const [config, setConfig] = useState(placeholderConfig('compliance'));
  const [tags, setTags] = useState('');
  const [busy, setBusy] = useState(false);
  const [formErr, setFormErr] = useState<string | null>(null);
  const [actionErr, setActionErr] = useState<string | null>(null);

  const { data, loading, error, refetch } = useApi(
    () => listEvaluators({
      scorerType: scorerType || undefined,
      status: status || undefined,
      builtin: kind === '' ? undefined : kind === 'builtin',
    }),
    [scorerType, status, kind],
  );
  const evaluators = data?.evaluators ?? [];

  const handleCreate = useCallback(async () => {
    setFormErr(null);
    if (!name.trim()) { setFormErr('Name is required'); return; }
    let parsed: Record<string, unknown>;
    try { parsed = JSON.parse(config); } catch { setFormErr('configTemplate must be valid JSON'); return; }
    setBusy(true);
    try {
      await createEvaluator({ name: name.trim(), scorerType: type, configTemplate: parsed, tags: tags.split(',').map((t) => t.trim()).filter(Boolean) });
      setShowCreate(false); setName(''); setTags(''); setConfig(placeholderConfig(type));
      refetch();
    } catch (e) { setFormErr(e instanceof Error ? e.message : 'Create failed'); }
    finally { setBusy(false); }
  }, [name, type, config, tags, refetch]);

  const act = useCallback(async (fn: () => Promise<unknown>) => {
    setActionErr(null);
    try { await fn(); refetch(); }
    catch (e) { setActionErr(e instanceof Error ? e.message : 'Action failed'); refetch(); }
  }, [refetch]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Evaluator Catalog</h1>
          <p className="text-sm text-gray-500 mt-1">
            Reusable scorer definitions — reference one by id from session scoring. Built-ins are read-only.
          </p>
        </div>
        <button onClick={() => { setShowCreate((s) => !s); setFormErr(null); }} className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 transition-colors">
          {showCreate ? 'Cancel' : 'New Evaluator'}
        </button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3 rounded-lg border border-gray-200 bg-white p-3">
        <select value={scorerType} onChange={(e) => setScorerType(e.target.value)} className="rounded border border-gray-300 bg-white px-3 py-1.5 text-sm">
          <option value="">All types</option>
          {SCORER_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <select value={status} onChange={(e) => setStatus(e.target.value)} className="rounded border border-gray-300 bg-white px-3 py-1.5 text-sm">
          <option value="">Any status</option>
          <option value="draft">Draft</option>
          <option value="published">Published</option>
        </select>
        <select value={kind} onChange={(e) => setKind(e.target.value)} className="rounded border border-gray-300 bg-white px-3 py-1.5 text-sm">
          <option value="">Built-in + custom</option>
          <option value="builtin">Built-in only</option>
          <option value="custom">Custom only</option>
        </select>
      </div>

      {error && <div className="p-4 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">Error loading evaluators: {error}</div>}
      {actionErr && (
        <div className="flex items-center justify-between p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
          <span>Action failed: {actionErr}</span>
          <button onClick={() => setActionErr(null)} className="text-red-500 hover:text-red-700">✕</button>
        </div>
      )}

      {/* Create form */}
      {showCreate && (
        <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm space-y-4">
          <h3 className="text-base font-semibold text-gray-900">New Evaluator</h3>
          {formErr && <div className="p-2 bg-red-50 border border-red-200 rounded text-red-700 text-sm">{formErr}</div>}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Name *</label>
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g., No PII exfiltration" className="w-full rounded border border-gray-300 px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Scorer type</label>
              <select value={type} onChange={(e) => { const t = e.target.value as ScorerType; setType(t); setConfig(placeholderConfig(t)); }} className="w-full rounded border border-gray-300 bg-white px-3 py-2 text-sm">
                {SCORER_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Tags (comma-separated)</label>
            <input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="pii, security" className="w-full rounded border border-gray-300 px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">configTemplate (JSON)</label>
            <textarea value={config} onChange={(e) => setConfig(e.target.value)} rows={6} spellCheck={false} className="w-full rounded border border-gray-300 px-3 py-2 text-sm font-mono" />
          </div>
          <div className="flex justify-end">
            <button onClick={handleCreate} disabled={busy} className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50">
              {busy ? 'Creating…' : 'Create'}
            </button>
          </div>
        </div>
      )}

      {/* List */}
      {loading && !data ? (
        <div className="space-y-3">{[...Array(4)].map((_, i) => <div key={i} className="h-20 animate-pulse rounded-lg bg-gray-100" />)}</div>
      ) : evaluators.length === 0 ? (
        <div className="rounded-xl border border-gray-200 bg-white p-12 text-center shadow-sm">
          <span className="text-4xl">⚖️</span>
          <h3 className="mt-4 text-lg font-semibold text-gray-900">No evaluators match these filters</h3>
        </div>
      ) : (
        <div className="space-y-3">
          {evaluators.map((ev) => <EvaluatorCard key={ev.id} ev={ev} act={act} />)}
        </div>
      )}
    </div>
  );
}

function EvaluatorCard({ ev, act }: { ev: EvaluatorDefinition; act: (fn: () => Promise<unknown>) => void }): React.ReactElement {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-semibold text-gray-900">{ev.name}</span>
            <Badge color="bg-cyan-50 text-cyan-700">{ev.scorerType}</Badge>
            {ev.builtin && <Badge color="bg-gray-100 text-gray-600">built-in</Badge>}
            <Badge color={ev.status === 'published' ? 'bg-green-50 text-green-700' : 'bg-amber-50 text-amber-700'}>{ev.status}</Badge>
            {ev.verifiedAt && <Badge color="bg-violet-100 text-violet-700">✓ verified</Badge>}
          </div>
          {ev.description && <p className="mt-1 text-sm text-gray-600">{ev.description}</p>}
          {ev.tags.length > 0 && <div className="mt-1.5 flex gap-1 flex-wrap">{ev.tags.map((t) => <span key={t} className="text-xs text-gray-400">#{t}</span>)}</div>}
          <code className="mt-1 block text-xs text-gray-400">{ev.id}</code>
        </div>
        {!ev.builtin && (
          <div className="flex flex-shrink-0 gap-2">
            {ev.status === 'draft' && (
              <button onClick={() => act(() => publishEvaluator(ev.id))} className="rounded border border-gray-300 px-2.5 py-1 text-xs text-gray-700 hover:bg-gray-50">Publish</button>
            )}
            {!ev.verifiedAt && (
              <button onClick={() => act(() => verifyEvaluator(ev.id))} className="rounded border border-gray-300 px-2.5 py-1 text-xs text-gray-700 hover:bg-gray-50">Verify</button>
            )}
            <button onClick={() => act(() => deleteEvaluator(ev.id))} className="rounded border border-red-200 px-2.5 py-1 text-xs text-red-600 hover:bg-red-50">Delete</button>
          </div>
        )}
      </div>
      <details className="mt-2">
        <summary className="text-xs text-blue-500 cursor-pointer hover:text-blue-700">configTemplate</summary>
        <pre className="mt-1.5 rounded bg-gray-50 border border-gray-200 p-2 text-xs overflow-x-auto">{JSON.stringify(ev.configTemplate, null, 2)}</pre>
      </details>
    </div>
  );
}
