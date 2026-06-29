/**
 * EvalRunCompare (#121) — side-by-side regression comparison of two dataset runs.
 * Pick a baseline + current run; shows pass-rate / avg-score deltas, the set of
 * cases that flipped (pass↔fail), the prompt/model variant per run, and a
 * dataset-version-mismatch warning.
 */
import { useState } from 'react';
import { useApi } from '../../hooks/useApi';
import { getEvalRuns, getRunComparison } from '../../api/eval';
import type { EvalRun, RegressionReport } from '../../api/eval';

const pct = (n: number): string => `${n >= 0 ? '+' : ''}${(n * 100).toFixed(1)}%`;
const passRate = (r: EvalRun): number => (r.totalCases > 0 ? r.passedCases / r.totalCases : 0);
const errMsg = (e: unknown): string => (e instanceof Error ? e.message : String(e));

function runLabel(r: EvalRun): string {
  const variant = [r.promptVersionId ? `prompt ${r.promptVersionId.slice(0, 8)}` : '', r.modelId ?? '']
    .filter(Boolean)
    .join(' · ');
  return `${r.id.slice(0, 8)} · ${(passRate(r) * 100).toFixed(0)}% (${r.passedCases}/${r.totalCases})${variant ? ` · ${variant}` : ''}`;
}

function Stat({ label, value, good }: { label: string; value: string; good: boolean }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-3">
      <div className="text-xs text-gray-500">{label}</div>
      <div className={`text-lg font-semibold ${good ? 'text-green-700' : 'text-red-700'}`}>{value}</div>
    </div>
  );
}

function ReportView({ report }: { report: RegressionReport }) {
  const tone = report.overallRegression
    ? 'bg-red-50 border-red-200 text-red-800'
    : 'bg-green-50 border-green-200 text-green-800';
  return (
    <div className="space-y-3">
      <div className={`rounded-lg border p-3 text-sm font-medium ${tone}`}>
        {report.overallRegression ? '✗ Regression detected' : '✓ No regression'}
        {report.datasetVersionMismatch && (
          <div className="mt-1 text-amber-700 font-normal">
            ⚠ These runs are over different dataset versions — deltas may be misleading.
          </div>
        )}
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Stat label="Δ pass-rate" value={pct(report.passRateDelta)} good={report.passRateDelta >= 0} />
        <Stat label="Δ avg-score" value={pct(report.avgScoreDelta)} good={report.avgScoreDelta >= 0} />
      </div>
      <div>
        <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">
          Flipped cases ({report.flippedCases.length})
        </h3>
        {report.flippedCases.length === 0 ? (
          <p className="text-sm text-gray-500">No cases changed pass/fail status.</p>
        ) : (
          <ul className="divide-y divide-gray-100 rounded-lg border border-gray-200">
            {report.flippedCases.map((f) => (
              <li key={f.testCaseId} className="flex items-center gap-3 px-3 py-1.5 text-sm">
                <span className={`font-medium ${f.direction === 'pass_to_fail' ? 'text-red-700' : 'text-green-700'}`}>
                  {f.direction === 'pass_to_fail' ? '↓ pass→fail' : '↑ fail→pass'}
                </span>
                <span className="font-mono text-xs text-gray-500">{f.testCaseId.slice(0, 8)}</span>
                <span className="ml-auto text-xs text-gray-400 tabular-nums">
                  {f.baselineScore.toFixed(2)} → {f.currentScore.toFixed(2)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export function EvalRunCompare({ datasetId }: { datasetId: string }) {
  const { data, loading } = useApi(() => getEvalRuns({ datasetId, limit: 50 }), [datasetId]);
  const runs = (data?.runs ?? []).filter((r) => r.status === 'completed');

  const [baselineId, setBaselineId] = useState('');
  const [currentId, setCurrentId] = useState('');
  const [report, setReport] = useState<RegressionReport | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function compare() {
    if (!currentId || !baselineId) return;
    setBusy(true);
    setError(null);
    setReport(null);
    try {
      setReport(await getRunComparison(currentId, baselineId));
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm space-y-4">
      <h2 className="text-sm font-semibold text-gray-900">Compare runs</h2>
      {loading ? (
        <p className="text-sm text-gray-500">Loading runs…</p>
      ) : runs.length < 2 ? (
        <p className="text-sm text-gray-500">Run this dataset at least twice to compare runs.</p>
      ) : (
        <>
          <div className="flex flex-wrap items-end gap-2">
            <label className="text-xs text-gray-600">
              Baseline
              <select
                value={baselineId}
                onChange={(e) => setBaselineId(e.target.value)}
                className="block mt-0.5 border border-gray-300 rounded px-2 py-1 text-sm max-w-xs"
              >
                <option value="">— select —</option>
                {runs.map((r) => (
                  <option key={r.id} value={r.id}>
                    {runLabel(r)}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs text-gray-600">
              Current
              <select
                value={currentId}
                onChange={(e) => setCurrentId(e.target.value)}
                className="block mt-0.5 border border-gray-300 rounded px-2 py-1 text-sm max-w-xs"
              >
                <option value="">— select —</option>
                {runs.map((r) => (
                  <option key={r.id} value={r.id}>
                    {runLabel(r)}
                  </option>
                ))}
              </select>
            </label>
            <button
              onClick={compare}
              disabled={busy || !currentId || !baselineId}
              className="px-3 py-1.5 text-sm rounded bg-brand-600 hover:bg-brand-700 text-white disabled:opacity-50"
            >
              Compare
            </button>
          </div>
          {error && <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded px-3 py-2">{error}</div>}
          {report && <ReportView report={report} />}
        </>
      )}
    </section>
  );
}
