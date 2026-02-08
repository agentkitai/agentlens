/**
 * Create Benchmark Page (Story 6.2)
 *
 * Route: /benchmarks/new
 *
 * Features:
 *  - Form: Name, Description, Agent dropdown, Min sessions
 *  - Variant editor: starts with 2 rows, add/remove (min 2, max 10)
 *  - Metric selector: checkboxes for 8 metrics
 *  - Time range: optional date pickers
 *  - Validation, submit, error display
 *  - Help text explaining tagging workflow
 */
import React, { useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApi } from '../hooks/useApi';
import { getAgents, createBenchmark } from '../api/client';

// ─── Constants ──────────────────────────────────────────────────────

const ALL_METRICS = [
  { id: 'cost_per_session', label: 'Cost per Session' },
  { id: 'avg_latency', label: 'Average Latency' },
  { id: 'error_rate', label: 'Error Rate' },
  { id: 'tool_call_count', label: 'Tool Call Count' },
  { id: 'tokens_per_session', label: 'Tokens per Session' },
  { id: 'session_duration', label: 'Session Duration' },
  { id: 'task_completion', label: 'Task Completion' },
  { id: 'user_satisfaction', label: 'User Satisfaction' },
];

const MAX_VARIANTS = 10;
const MIN_VARIANTS = 2;

interface VariantRow {
  key: number;
  name: string;
  tag: string;
  description: string;
}

interface FormErrors {
  name?: string;
  variants?: string;
  metrics?: string;
  api?: string;
}

function emptyVariant(key: number): VariantRow {
  return { key, name: '', tag: '', description: '' };
}

// ─── Component ──────────────────────────────────────────────────────

export function BenchmarkNew(): React.ReactElement {
  const navigate = useNavigate();

  // Agents for dropdown
  const { data: agents } = useApi(() => getAgents(), []);

  // Form state
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [agentId, setAgentId] = useState('');
  const [minSessions, setMinSessions] = useState(30);
  const [variants, setVariants] = useState<VariantRow[]>([emptyVariant(1), emptyVariant(2)]);
  const [metrics, setMetrics] = useState<Set<string>>(new Set(ALL_METRICS.map((m) => m.id)));
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [errors, setErrors] = useState<FormErrors>({});
  const [submitting, setSubmitting] = useState(false);

  // Variant key counter
  const [nextKey, setNextKey] = useState(3);

  // ─── Variant Handlers ───────────────────────────────────────────

  const updateVariant = useCallback((key: number, field: keyof VariantRow, value: string) => {
    setVariants((prev) =>
      prev.map((v) => (v.key === key ? { ...v, [field]: value } : v)),
    );
  }, []);

  const addVariant = useCallback(() => {
    setVariants((prev) => {
      if (prev.length >= MAX_VARIANTS) return prev;
      return [...prev, emptyVariant(nextKey)];
    });
    setNextKey((k) => k + 1);
  }, [nextKey]);

  const removeVariant = useCallback((key: number) => {
    setVariants((prev) => {
      if (prev.length <= MIN_VARIANTS) return prev;
      return prev.filter((v) => v.key !== key);
    });
  }, []);

  // ─── Metric Toggle ─────────────────────────────────────────────

  const toggleMetric = useCallback((id: string) => {
    setMetrics((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  // ─── Validate ───────────────────────────────────────────────────

  const validate = useCallback((): FormErrors => {
    const errs: FormErrors = {};

    if (!name.trim()) {
      errs.name = 'Name is required.';
    }

    const validVariants = variants.filter((v) => v.name.trim() && v.tag.trim());
    if (validVariants.length < MIN_VARIANTS) {
      errs.variants = `At least ${MIN_VARIANTS} variants are required, each with a name and tag.`;
    }

    if (metrics.size === 0) {
      errs.metrics = 'At least one metric must be selected.';
    }

    return errs;
  }, [name, variants, metrics]);

  // ─── Submit ─────────────────────────────────────────────────────

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      const errs = validate();
      setErrors(errs);
      if (Object.keys(errs).length > 0) return;

      setSubmitting(true);
      try {
        const result = await createBenchmark({
          name: name.trim(),
          description: description.trim() || undefined,
          agentId: agentId || undefined,
          minSessions,
          variants: variants
            .filter((v) => v.name.trim() && v.tag.trim())
            .map((v) => ({
              name: v.name.trim(),
              tag: v.tag.trim(),
              description: v.description.trim() || undefined,
            })),
          metrics: Array.from(metrics),
          startDate: startDate || undefined,
          endDate: endDate || undefined,
        });
        navigate(`/benchmarks/${result.id}`);
      } catch (err) {
        setErrors({
          api: err instanceof Error ? err.message : 'Failed to create benchmark.',
        });
      } finally {
        setSubmitting(false);
      }
    },
    [name, description, agentId, minSessions, variants, metrics, startDate, endDate, validate, navigate],
  );

  return (
    <div className="max-w-3xl mx-auto space-y-8">
      {/* Header */}
      <div>
        <button
          type="button"
          onClick={() => navigate('/benchmarks')}
          className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 mb-4"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
          </svg>
          Back to Benchmarks
        </button>
        <h2 className="text-2xl font-bold text-gray-900">New Benchmark</h2>
        <p className="mt-1 text-sm text-gray-500">
          Set up an A/B test to compare agent configurations
        </p>
      </div>

      {/* API error */}
      {errors.api && (
        <div className="rounded-lg bg-red-50 border border-red-200 p-4 text-sm text-red-700">
          {errors.api}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-8">
        {/* ─── Basic Info ────────────────────────────────────────── */}
        <section className="space-y-4">
          <h3 className="text-lg font-semibold text-gray-900">Basic Information</h3>

          {/* Name */}
          <div>
            <label htmlFor="bm-name" className="block text-sm font-medium text-gray-700">
              Name <span className="text-red-500">*</span>
            </label>
            <input
              id="bm-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g., GPT-4o vs Claude Sonnet"
              className={`mt-1 block w-full rounded-md border px-3 py-2 text-sm shadow-sm focus:ring-2 focus:ring-brand-500 focus:border-brand-500 ${
                errors.name ? 'border-red-300' : 'border-gray-300'
              }`}
            />
            {errors.name && <p className="mt-1 text-xs text-red-600">{errors.name}</p>}
          </div>

          {/* Description */}
          <div>
            <label htmlFor="bm-desc" className="block text-sm font-medium text-gray-700">
              Description
            </label>
            <textarea
              id="bm-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What are you testing?"
              rows={3}
              className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:ring-2 focus:ring-brand-500 focus:border-brand-500"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            {/* Agent */}
            <div>
              <label htmlFor="bm-agent" className="block text-sm font-medium text-gray-700">
                Agent <span className="text-gray-400">(optional)</span>
              </label>
              <select
                id="bm-agent"
                value={agentId}
                onChange={(e) => setAgentId(e.target.value)}
                className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:ring-2 focus:ring-brand-500 focus:border-brand-500"
              >
                <option value="">All agents</option>
                {(agents ?? []).map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name || a.id}
                  </option>
                ))}
              </select>
            </div>

            {/* Min sessions */}
            <div>
              <label htmlFor="bm-min" className="block text-sm font-medium text-gray-700">
                Min Sessions per Variant
              </label>
              <input
                id="bm-min"
                type="number"
                min={1}
                value={minSessions}
                onChange={(e) => setMinSessions(Number(e.target.value) || 30)}
                className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:ring-2 focus:ring-brand-500 focus:border-brand-500"
              />
            </div>
          </div>
        </section>

        {/* ─── Variants ──────────────────────────────────────────── */}
        <section className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-semibold text-gray-900">Variants</h3>
            <button
              type="button"
              onClick={addVariant}
              disabled={variants.length >= MAX_VARIANTS}
              className="inline-flex items-center gap-1 text-sm text-brand-600 hover:text-brand-800 font-medium disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
              </svg>
              Add Variant ({variants.length}/{MAX_VARIANTS})
            </button>
          </div>

          {errors.variants && (
            <p className="text-xs text-red-600">{errors.variants}</p>
          )}

          <div className="space-y-3">
            {variants.map((v, idx) => (
              <div
                key={v.key}
                className="rounded-lg border border-gray-200 bg-gray-50 p-4 space-y-3"
              >
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-gray-700">Variant {idx + 1}</span>
                  <button
                    type="button"
                    onClick={() => removeVariant(v.key)}
                    disabled={variants.length <= MIN_VARIANTS}
                    className="text-xs text-red-500 hover:text-red-700 disabled:opacity-30 disabled:cursor-not-allowed"
                  >
                    Remove
                  </button>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-600">
                      Name <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="text"
                      value={v.name}
                      onChange={(e) => updateVariant(v.key, 'name', e.target.value)}
                      placeholder="e.g., Control"
                      className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm shadow-sm focus:ring-2 focus:ring-brand-500 focus:border-brand-500"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600">
                      Tag <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="text"
                      value={v.tag}
                      onChange={(e) => updateVariant(v.key, 'tag', e.target.value)}
                      placeholder="config:model-a"
                      className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm shadow-sm focus:ring-2 focus:ring-brand-500 focus:border-brand-500"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600">
                    Description
                  </label>
                  <input
                    type="text"
                    value={v.description}
                    onChange={(e) => updateVariant(v.key, 'description', e.target.value)}
                    placeholder="Optional description"
                    className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm shadow-sm focus:ring-2 focus:ring-brand-500 focus:border-brand-500"
                  />
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* ─── Metrics ───────────────────────────────────────────── */}
        <section className="space-y-4">
          <h3 className="text-lg font-semibold text-gray-900">Metrics</h3>
          <p className="text-sm text-gray-500">
            Select which metrics to compare across variants.
          </p>

          {errors.metrics && (
            <p className="text-xs text-red-600">{errors.metrics}</p>
          )}

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {ALL_METRICS.map((m) => (
              <label
                key={m.id}
                className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm cursor-pointer transition-colors ${
                  metrics.has(m.id)
                    ? 'border-brand-300 bg-brand-50 text-brand-700'
                    : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300'
                }`}
              >
                <input
                  type="checkbox"
                  checked={metrics.has(m.id)}
                  onChange={() => toggleMetric(m.id)}
                  className="rounded border-gray-300 text-brand-600 focus:ring-brand-500"
                />
                {m.label}
              </label>
            ))}
          </div>
        </section>

        {/* ─── Time Range ────────────────────────────────────────── */}
        <section className="space-y-4">
          <h3 className="text-lg font-semibold text-gray-900">
            Time Range <span className="text-sm font-normal text-gray-400">(optional)</span>
          </h3>
          <p className="text-sm text-gray-500">
            Restrict which sessions are included based on creation time.
          </p>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label htmlFor="bm-start" className="block text-sm font-medium text-gray-700">
                Start Date
              </label>
              <input
                id="bm-start"
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:ring-2 focus:ring-brand-500 focus:border-brand-500"
              />
            </div>
            <div>
              <label htmlFor="bm-end" className="block text-sm font-medium text-gray-700">
                End Date
              </label>
              <input
                id="bm-end"
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:ring-2 focus:ring-brand-500 focus:border-brand-500"
              />
            </div>
          </div>
        </section>

        {/* ─── Help Text ─────────────────────────────────────────── */}
        <section className="rounded-lg bg-blue-50 border border-blue-200 p-4 space-y-2">
          <h4 className="text-sm font-semibold text-blue-800">💡 How Tagging Works</h4>
          <p className="text-sm text-blue-700">
            Each variant is identified by a <strong>tag</strong> (e.g., <code className="bg-blue-100 px-1 rounded">config:model-a</code>).
            Tag your sessions with the variant&apos;s tag using session metadata or the MCP tool so
            the benchmark can group sessions by variant.
          </p>
          <p className="text-sm text-blue-700">
            Use the <code className="bg-blue-100 px-1 rounded">config:</code> prefix convention
            to keep benchmark tags separate from regular tags.
          </p>
        </section>

        {/* ─── Actions ───────────────────────────────────────────── */}
        <div className="flex items-center justify-end gap-3 pt-4 border-t border-gray-200">
          <button
            type="button"
            onClick={() => navigate('/benchmarks')}
            className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={submitting}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-brand-600 rounded-lg hover:bg-brand-700 transition-colors disabled:opacity-50"
          >
            {submitting && (
              <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" />
            )}
            Create Benchmark
          </button>
        </div>
      </form>
    </div>
  );
}
