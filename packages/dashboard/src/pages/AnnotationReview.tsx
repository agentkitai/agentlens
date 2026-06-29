/**
 * Annotation Review (#146)
 *
 * Route: /review/:queueId
 *
 * Keyboard-driven reviewer over the existing /api/annotations backend (#122):
 * claim → score → next. Submitting writes exactly one human_score (annotator
 * identity is set server-side); the score then appears on the session/trace.
 *
 * Shortcuts: p=pass · f=fail · n=needs review · Enter=submit · s=skip · j/k=next/prev
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams, useNavigate } from 'react-router-dom';
import { useApi } from '../hooks/useApi';
import { getQueue, submitScore, skipItem, type AnnotationItem, type HumanScoreRequest } from '../api/annotations';

type Verdict = 'pass' | 'fail' | 'needs_review' | '';

function countByStatus(items: AnnotationItem[]): Record<string, number> {
  const c: Record<string, number> = { pending: 0, in_review: 0, scored: 0, skipped: 0 };
  for (const i of items) c[i.status] = (c[i.status] ?? 0) + 1;
  return c;
}

export function AnnotationReview(): React.ReactElement {
  const { queueId = '' } = useParams();
  const navigate = useNavigate();
  const { data, loading, error } = useApi(() => getQueue(queueId), [queueId]);

  const queue = data?.queue;
  const allItems = useMemo(() => data?.items ?? [], [data]);
  // Reviewable set fixed at load so advancing isn't disturbed by re-renders.
  const reviewable = useMemo(
    () => allItems.filter((i) => i.status === 'pending' || i.status === 'in_review'),
    [allItems],
  );
  const counts = useMemo(() => countByStatus(allItems), [allItems]);
  const evaluatorId = typeof queue?.config?.evaluatorId === 'string' ? (queue.config.evaluatorId as string) : undefined;

  const [idx, setIdx] = useState(0);
  const current: AnnotationItem | undefined = reviewable[idx];

  // Score form state
  const [verdict, setVerdict] = useState<Verdict>('');
  const [score, setScore] = useState('');
  const [reasoning, setReasoning] = useState('');
  const [labels, setLabels] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [submittedCount, setSubmittedCount] = useState(0);
  const [skippedCount, setSkippedCount] = useState(0);

  const resetForm = useCallback(() => {
    setVerdict('');
    setScore('');
    setReasoning('');
    setLabels('');
    setFormError(null);
  }, []);

  const submit = useCallback(async () => {
    if (!current || submitting) return;
    const body: HumanScoreRequest = {};
    if (verdict) {
      body.verdict = verdict;
      if (verdict === 'pass') body.passed = true;
      if (verdict === 'fail') body.passed = false;
    }
    if (score.trim() !== '') {
      const n = Number(score);
      if (!Number.isNaN(n)) body.score = Math.max(0, Math.min(1, n));
    }
    if (reasoning.trim()) body.reasoning = reasoning.trim();
    const labelList = labels.split(',').map((s) => s.trim()).filter(Boolean);
    if (labelList.length) body.labels = labelList;
    if (evaluatorId) body.evaluatorId = evaluatorId;
    if (current.traceId) body.traceId = current.traceId;

    if (body.score === undefined && body.verdict === undefined && body.passed === undefined) {
      setFormError('Provide a score, verdict, or pass/fail.');
      return;
    }
    setSubmitting(true);
    setFormError(null);
    try {
      await submitScore(current.id, body);
      setSubmittedCount((n) => n + 1);
      resetForm();
      setIdx((i) => i + 1);
    } catch (e) {
      setFormError(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  }, [current, submitting, verdict, score, reasoning, labels, evaluatorId, resetForm]);

  const skip = useCallback(async () => {
    if (!current || submitting) return;
    setSubmitting(true);
    try {
      await skipItem(current.id);
      setSkippedCount((n) => n + 1);
      resetForm();
      setIdx((i) => i + 1);
    } catch (e) {
      setFormError(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  }, [current, submitting, resetForm]);

  // Keyboard shortcuts (ignore single-letter keys while typing in a field).
  useEffect(() => {
    const handler = (e: KeyboardEvent): void => {
      const tag = (e.target as HTMLElement)?.tagName;
      const typing = tag === 'INPUT' || tag === 'TEXTAREA';
      if (e.key === 'Enter' && (!typing || e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        void submit();
        return;
      }
      if (typing) return;
      if (e.key === 'p') setVerdict('pass');
      else if (e.key === 'f') setVerdict('fail');
      else if (e.key === 'n') setVerdict('needs_review');
      else if (e.key === 's') void skip();
      else if (e.key === 'j' || e.key === 'ArrowDown') setIdx((i) => Math.min(i + 1, reviewable.length));
      else if (e.key === 'k' || e.key === 'ArrowUp') setIdx((i) => Math.max(i - 1, 0));
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [submit, skip, reviewable.length]);

  if (loading) return <div className="max-w-3xl mx-auto p-6 text-gray-500">Loading queue…</div>;
  if (error) return <div className="max-w-3xl mx-auto p-6 text-red-600">Failed to load queue: {error}</div>;
  if (!queue) return <div className="max-w-3xl mx-auto p-6 text-gray-500">Queue not found.</div>;

  const reviewedTotal = counts.scored + submittedCount;
  const progressTotal = allItems.length || 1;

  return (
    <div className="max-w-3xl mx-auto p-6">
      <div className="mb-4">
        <button onClick={() => navigate('/review')} className="text-sm text-blue-600 hover:underline mb-2">
          ← All queues
        </button>
        <h1 className="text-2xl font-semibold text-gray-900">{queue.name}</h1>
        {queue.description && <p className="text-sm text-gray-500 mt-1">{queue.description}</p>}
      </div>

      {/* Progress */}
      <div className="mb-4">
        <div className="flex justify-between text-xs text-gray-500 mb-1">
          <span>
            {reviewedTotal} scored · {skippedCount + counts.skipped} skipped · {counts.pending + counts.in_review} in queue
          </span>
          <span>{Math.round((reviewedTotal / progressTotal) * 100)}%</span>
        </div>
        <div className="h-2 bg-gray-100 rounded">
          <div className="h-2 bg-green-500 rounded" style={{ width: `${(reviewedTotal / progressTotal) * 100}%` }} />
        </div>
      </div>

      {!current ? (
        <div className="border border-dashed border-gray-300 rounded-lg p-8 text-center text-gray-600">
          🎉 Nothing left to review in this queue.
        </div>
      ) : (
        <div className="bg-white border border-gray-200 rounded-lg p-5">
          <div className="flex items-center justify-between mb-4">
            <div className="text-sm text-gray-500">
              Item {idx + 1} of {reviewable.length} · status <span className="font-medium">{current.status}</span>
              {current.assignee && <> · assigned to {current.assignee}</>}
            </div>
            <Link to={`/sessions/${current.sessionId}`} className="text-sm text-blue-600 hover:underline">
              Open session ↗
            </Link>
          </div>

          <div className="text-sm text-gray-700 mb-4">
            <div>
              Session <code className="bg-gray-100 px-1 rounded">{current.sessionId}</code>
            </div>
            {current.traceId && (
              <div className="mt-1">
                Trace <code className="bg-gray-100 px-1 rounded">{current.traceId}</code>
              </div>
            )}
          </div>

          {/* Verdict */}
          <div className="mb-3">
            <div className="text-xs font-medium text-gray-600 mb-1">Verdict</div>
            <div className="flex gap-2">
              {([
                ['pass', 'Pass (p)', 'bg-green-600'],
                ['fail', 'Fail (f)', 'bg-red-600'],
                ['needs_review', 'Needs review (n)', 'bg-yellow-500'],
              ] as const).map(([v, label, color]) => (
                <button
                  key={v}
                  onClick={() => setVerdict(v)}
                  className={`px-3 py-1.5 rounded text-sm text-white ${verdict === v ? color : 'bg-gray-300 hover:bg-gray-400'}`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* Numeric score */}
          <div className="mb-3">
            <label className="block text-xs font-medium text-gray-600 mb-1">Score (0–1, optional)</label>
            <input
              type="number"
              min={0}
              max={1}
              step={0.1}
              value={score}
              onChange={(e) => setScore(e.target.value)}
              className="w-32 border border-gray-300 rounded px-2 py-1 text-sm"
            />
          </div>

          {/* Reasoning */}
          <div className="mb-3">
            <label className="block text-xs font-medium text-gray-600 mb-1">Reasoning (optional)</label>
            <textarea
              value={reasoning}
              onChange={(e) => setReasoning(e.target.value)}
              rows={3}
              className="w-full border border-gray-300 rounded px-2 py-1 text-sm"
              placeholder="Why this score? (Ctrl+Enter to submit)"
            />
          </div>

          {/* Labels */}
          <div className="mb-4">
            <label className="block text-xs font-medium text-gray-600 mb-1">Labels (comma-separated, optional)</label>
            <input
              type="text"
              value={labels}
              onChange={(e) => setLabels(e.target.value)}
              className="w-full border border-gray-300 rounded px-2 py-1 text-sm"
              placeholder="hallucination, off-topic"
            />
          </div>

          {evaluatorId && (
            <div className="text-xs text-gray-400 mb-3">
              Scoring against evaluator <code>{evaluatorId}</code>
            </div>
          )}
          {formError && <div className="text-sm text-red-600 mb-3">{formError}</div>}

          <div className="flex gap-2">
            <button
              onClick={() => void submit()}
              disabled={submitting}
              className="px-4 py-1.5 rounded bg-blue-600 text-white text-sm hover:bg-blue-700 disabled:opacity-50"
            >
              {submitting ? 'Saving…' : 'Submit score (↵)'}
            </button>
            <button
              onClick={() => void skip()}
              disabled={submitting}
              className="px-4 py-1.5 rounded border border-gray-300 text-gray-700 text-sm hover:bg-gray-50 disabled:opacity-50"
            >
              Skip (s)
            </button>
          </div>

          <div className="text-xs text-gray-400 mt-4">
            Shortcuts: <b>p</b> pass · <b>f</b> fail · <b>n</b> needs review · <b>↵</b> submit · <b>s</b> skip ·{' '}
            <b>j/k</b> next/prev
          </div>
        </div>
      )}
    </div>
  );
}

export default AnnotationReview;
