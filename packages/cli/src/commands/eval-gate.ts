/**
 * agentlens eval-gate — CI/CD eval gate (#55 Phase 5).
 *
 * Fails (exit 1) when the eval pass-rate is below a threshold, so it can gate a PR.
 * Two modes (chosen by which flag is given):
 *   --dataset-id   DATASET-RUN: trigger a dataset eval run against a live agent
 *                  webhook, poll to completion, gate on passedCases/totalCases.
 *   --evaluator-id TRACE-SCORING: score a set of sessions ("this PR's trace subset")
 *                  against a catalog evaluator (no webhook needed), gate on the
 *                  fraction of sessions that pass.
 */
import { parseArgs } from 'node:util';
import { loadConfig } from '../lib/config.js';
import { printJson } from '../lib/output.js';

const HELP = `Usage: agentlens eval-gate [options]

Gate a PR on an eval pass-rate (exit 1 if below threshold).

Mode A — dataset run (needs a live agent webhook):
  --dataset-id <id>        Eval dataset to run
  --agent-id <id>          Agent id for the run
  --webhook-url <url>      Agent webhook the runner calls per test case
  --timeout-seconds <n>    Max wait for the run to finish (default 1800)
  --poll-interval <n>      Seconds between status polls (default 3)

Mode B — trace scoring (no webhook; reuses the evaluator catalog):
  --evaluator-id <id>      Catalog evaluator (compliance or llm_judge)
  --session-ids a,b,c      Explicit sessions to score, OR
  --agent-id <id>          Score the agent's most-recent sessions
  --limit <n>              How many recent sessions (with --agent-id; default 20)

Common:
  --min-pass-rate <0..1>   Gate threshold (default 0.8)
  --url <url>              Server URL (overrides config)
  --format json|table      Output format (default table)
  -h, --help

Examples:
  agentlens eval-gate --dataset-id ds_1 --agent-id agt_1 --webhook-url https://app/eval --min-pass-rate 0.9
  agentlens eval-gate --evaluator-id builtin:pii-no-exfil --session-ids s1,s2,s3 --min-pass-rate 1.0
  agentlens eval-gate --evaluator-id ev_1 --agent-id agt_1 --limit 50`;

interface GateResult {
  mode: 'dataset-run' | 'trace-scoring';
  threshold: number;
  total: number;
  passed: number;
  passRate: number;
  gate: 'pass' | 'fail';
  runId?: string;
  evaluatorId?: string;
  sessions?: Array<{ sessionId: string; passed: boolean; score: number }>;
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

function fail(msg: string): never {
  console.error(`eval-gate: ${msg}`);
  process.exit(1);
}

async function api<T>(base: string, apiKey: string | undefined, path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${base.replace(/\/$/, '')}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}), ...init?.headers },
  });
  if (!res.ok) fail(`${init?.method ?? 'GET'} ${path} → HTTP ${res.status}: ${(await res.text().catch(() => '')) || res.statusText}`);
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export async function runEvalGateCommand(argv: string[]): Promise<void> {
  const { values } = parseArgs({
    args: argv,
    options: {
      'dataset-id': { type: 'string' },
      'evaluator-id': { type: 'string' },
      'agent-id': { type: 'string' },
      'webhook-url': { type: 'string' },
      'session-ids': { type: 'string' },
      'min-pass-rate': { type: 'string' },
      limit: { type: 'string' },
      'timeout-seconds': { type: 'string' },
      'poll-interval': { type: 'string' },
      format: { type: 'string', short: 'f' },
      url: { type: 'string' },
      help: { type: 'boolean', short: 'h', default: false },
    },
    allowPositionals: false,
  });
  if (values.help) { console.log(HELP); return; }

  const cfg = loadConfig();
  // Resolution: --url flag > AGENTLENS_SERVER_URL env > config file (CI sets env,
  // has no config file). The API key comes from env or config — never a flag, so
  // it isn't exposed in argv / the process list.
  const base = values.url ?? process.env['AGENTLENS_SERVER_URL'] ?? cfg.url;
  const apiKey = process.env['AGENTLENS_API_KEY'] ?? cfg.apiKey;
  const threshold = values['min-pass-rate'] !== undefined ? Number(values['min-pass-rate']) : 0.8;
  if (!Number.isFinite(threshold) || threshold < 0 || threshold > 1) fail('--min-pass-rate must be a number in [0, 1]');

  let result: GateResult;
  if (values['dataset-id']) result = await datasetRunGate(base, apiKey, values, threshold);
  else if (values['evaluator-id']) result = await traceScoringGate(base, apiKey, values, threshold);
  else fail('provide --dataset-id (dataset-run mode) or --evaluator-id (trace-scoring mode); see --help');

  if (values.format === 'json') printJson(result);
  else printGate(result);
  if (result.gate === 'fail') process.exit(1);
}

async function datasetRunGate(base: string, apiKey: string | undefined, v: Record<string, string | boolean | undefined>, threshold: number): Promise<GateResult> {
  if (!v['agent-id'] || !v['webhook-url']) fail('dataset-run mode needs --agent-id and --webhook-url');
  const created = await api<{ id: string }>(base, apiKey, '/api/eval/runs', {
    method: 'POST',
    body: JSON.stringify({ datasetId: v['dataset-id'], agentId: v['agent-id'], webhookUrl: v['webhook-url'], config: { passThreshold: threshold } }),
  });
  const timeoutSec = v['timeout-seconds'] ? Number(v['timeout-seconds']) : 1800;
  const pollSec = v['poll-interval'] ? Number(v['poll-interval']) : 3;
  if (!Number.isFinite(timeoutSec) || timeoutSec <= 0) fail('--timeout-seconds must be a positive number');
  if (!Number.isFinite(pollSec) || pollSec <= 0) fail('--poll-interval must be a positive number');
  const timeoutMs = timeoutSec * 1000;
  const pollMs = pollSec * 1000;
  const deadline = Date.now() + timeoutMs;
  type Run = { status: string; totalCases?: number; passedCases?: number; error?: string };
  let run: Run;
  for (;;) {
    run = await api<Run>(base, apiKey, `/api/eval/runs/${created.id}`);
    if (run.status === 'completed' || run.status === 'failed' || run.status === 'cancelled') break;
    if (Date.now() > deadline) fail(`run ${created.id} did not finish within ${timeoutMs / 1000}s (status: ${run.status})`);
    await sleep(pollMs);
  }
  if (run.status !== 'completed') fail(`run ${created.id} ended '${run.status}'${run.error ? `: ${run.error}` : ''}`);
  const total = run.totalCases ?? 0;
  const passed = run.passedCases ?? 0;
  const passRate = total > 0 ? passed / total : 0;
  return { mode: 'dataset-run', runId: created.id, threshold, total, passed, passRate, gate: passRate >= threshold ? 'pass' : 'fail' };
}

async function traceScoringGate(base: string, apiKey: string | undefined, v: Record<string, string | boolean | undefined>, threshold: number): Promise<GateResult> {
  const evaluatorId = String(v['evaluator-id']);
  const ev = await api<{ scorerType: string }>(base, apiKey, `/api/eval/evaluators/${encodeURIComponent(evaluatorId)}`);
  const endpoint = ev.scorerType === 'llm_judge' ? 'score' : ev.scorerType === 'compliance' ? 'compliance' : null;
  if (!endpoint) fail(`evaluator '${evaluatorId}' is scorerType '${ev.scorerType}'; only compliance and llm_judge can gate sessions`);

  let sessionIds: string[];
  if (v['session-ids']) {
    sessionIds = String(v['session-ids']).split(',').map((s) => s.trim()).filter(Boolean);
  } else if (v['agent-id']) {
    const limit = v.limit ? Number(v.limit) : 20;
    if (!Number.isFinite(limit) || limit <= 0) fail('--limit must be a positive number');
    const resp = await api<{ sessions: Array<{ id: string }> }>(base, apiKey, `/api/sessions?agentId=${encodeURIComponent(String(v['agent-id']))}&limit=${limit}`);
    sessionIds = (resp.sessions ?? []).map((s) => s.id);
  } else {
    fail('trace-scoring mode needs --session-ids or --agent-id');
  }
  if (sessionIds.length === 0) fail('no sessions to score');

  const sessions: GateResult['sessions'] = [];
  let passed = 0;
  for (const sid of sessionIds) {
    const r = await api<{ passed: boolean; score: number }>(base, apiKey, `/api/eval/sessions/${encodeURIComponent(sid)}/${endpoint}`, {
      method: 'POST',
      body: JSON.stringify({ evaluatorId }),
    });
    if (r.passed) passed++;
    sessions.push({ sessionId: sid, passed: r.passed, score: r.score });
  }
  const total = sessionIds.length;
  const passRate = passed / total;
  return { mode: 'trace-scoring', evaluatorId, threshold, total, passed, passRate, sessions, gate: passRate >= threshold ? 'pass' : 'fail' };
}

function printGate(r: GateResult): void {
  const pct = (r.passRate * 100).toFixed(1);
  const thr = (r.threshold * 100).toFixed(1);
  console.log(`\n  eval-gate (${r.mode})`);
  if (r.runId) console.log(`  run: ${r.runId}`);
  if (r.evaluatorId) console.log(`  evaluator: ${r.evaluatorId}`);
  console.log(`  passed: ${r.passed}/${r.total} (${pct}%)   threshold: ${thr}%`);
  console.log(`  → ${r.gate === 'pass' ? 'PASS ✓' : 'FAIL ✗'}\n`);
}
