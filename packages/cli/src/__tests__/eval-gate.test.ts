/**
 * Tests for the `agentlens eval-gate` CI gate (#55 Phase 5).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../lib/config.js', () => ({ loadConfig: () => ({ url: 'http://lens', apiKey: 'k' }) }));

import { runEvalGateCommand } from '../commands/eval-gate.js';

function jsonRes(body: unknown, status = 200): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body, text: async () => JSON.stringify(body) } as Response;
}

let out: string[];
let exitSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  out = [];
  vi.spyOn(console, 'log').mockImplementation((...a: unknown[]) => { out.push(a.join(' ')); });
  vi.spyOn(console, 'error').mockImplementation((...a: unknown[]) => { out.push(a.join(' ')); });
  // process.exit throws so we can assert it fired without killing the test runner.
  exitSpy = vi.spyOn(process, 'exit').mockImplementation(((c?: number) => { throw new Error(`__exit_${c ?? 0}`); }) as never);
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

// Route the mocked fetch by URL + method.
function routeFetch(routes: Record<string, (init?: RequestInit) => Response>) {
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    for (const [pat, fn] of Object.entries(routes)) {
      const [m, p] = pat.split(' ');
      if ((init?.method ?? 'GET') === m && url.includes(p)) return fn(init);
    }
    return jsonRes({ error: 'no route', url }, 404);
  }));
}

describe('eval-gate — trace-scoring mode', () => {
  it('PASSES when the session pass-rate meets the threshold', async () => {
    routeFetch({
      'GET /api/eval/evaluators/': () => jsonRes({ id: 'ev1', scorerType: 'compliance' }),
      'POST /api/eval/sessions/': () => jsonRes({ passed: true, score: 1 }),
    });
    await runEvalGateCommand(['--url', 'http://lens', '--evaluator-id', 'ev1', '--session-ids', 's1,s2,s3', '--min-pass-rate', '0.8']);
    expect(out.join('\n')).toContain('PASS');
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it('FAILS (exit 1) when below threshold', async () => {
    let n = 0;
    routeFetch({
      'GET /api/eval/evaluators/': () => jsonRes({ id: 'ev1', scorerType: 'compliance' }),
      'POST /api/eval/sessions/': () => jsonRes({ passed: ++n === 1, score: 0.5 }), // 1 of 3 passes
    });
    await expect(runEvalGateCommand(['--url', 'http://lens', '--evaluator-id', 'ev1', '--session-ids', 's1,s2,s3'])).rejects.toThrow('__exit_1');
  });

  it('resolves recent sessions via --agent-id', async () => {
    routeFetch({
      'GET /api/eval/evaluators/': () => jsonRes({ scorerType: 'compliance' }),
      'GET /api/sessions': () => jsonRes({ sessions: [{ id: 's1' }, { id: 's2' }], total: 2 }),
      'POST /api/eval/sessions/': () => jsonRes({ passed: true, score: 1 }),
    });
    await runEvalGateCommand(['--url', 'http://lens', '--evaluator-id', 'ev1', '--agent-id', 'agt_a', '--format', 'json']);
    const parsed = JSON.parse(out.join('\n'));
    expect(parsed.total).toBe(2);
    expect(parsed.gate).toBe('pass');
  });

  it('rejects an evaluator whose scorerType cannot gate sessions', async () => {
    routeFetch({ 'GET /api/eval/evaluators/': () => jsonRes({ scorerType: 'regex' }) });
    await expect(runEvalGateCommand(['--url', 'http://lens', '--evaluator-id', 'ev1', '--session-ids', 's1'])).rejects.toThrow('__exit_1');
  });

  it('FAILS when --agent-id resolves to zero sessions', async () => {
    routeFetch({
      'GET /api/eval/evaluators/': () => jsonRes({ scorerType: 'compliance' }),
      'GET /api/sessions': () => jsonRes({ sessions: [], total: 0 }),
    });
    await expect(runEvalGateCommand(['--url', 'http://lens', '--evaluator-id', 'ev1', '--agent-id', 'agt_a'])).rejects.toThrow('__exit_1');
  });

  it('exits 1 on an HTTP error from the scoring endpoint', async () => {
    routeFetch({
      'GET /api/eval/evaluators/': () => jsonRes({ scorerType: 'compliance' }),
      'POST /api/eval/sessions/': () => jsonRes({ error: 'boom' }, 500),
    });
    await expect(runEvalGateCommand(['--url', 'http://lens', '--evaluator-id', 'ev1', '--session-ids', 's1'])).rejects.toThrow('__exit_1');
  });
});

describe('eval-gate — dataset-run mode', () => {
  it('triggers a run, polls, and PASSES at/above threshold', async () => {
    routeFetch({
      'POST /api/eval/runs': () => jsonRes({ id: 'run1', status: 'pending' }),
      'GET /api/eval/runs/': () => jsonRes({ status: 'completed', totalCases: 10, passedCases: 9 }),
    });
    await runEvalGateCommand(['--url', 'http://lens', '--dataset-id', 'ds1', '--agent-id', 'agt_a', '--webhook-url', 'http://app/eval', '--min-pass-rate', '0.8']);
    expect(out.join('\n')).toContain('PASS');
  });

  it('FAILS when the run pass-rate is below threshold', async () => {
    routeFetch({
      'POST /api/eval/runs': () => jsonRes({ id: 'run1' }),
      'GET /api/eval/runs/': () => jsonRes({ status: 'completed', totalCases: 10, passedCases: 5 }),
    });
    await expect(runEvalGateCommand(['--url', 'http://lens', '--dataset-id', 'ds1', '--agent-id', 'a', '--webhook-url', 'http://app/eval'])).rejects.toThrow('__exit_1');
  });

  it('FAILS when the run itself errored', async () => {
    routeFetch({
      'POST /api/eval/runs': () => jsonRes({ id: 'run1' }),
      'GET /api/eval/runs/': () => jsonRes({ status: 'failed', error: 'webhook down' }),
    });
    await expect(runEvalGateCommand(['--url', 'http://lens', '--dataset-id', 'ds1', '--agent-id', 'a', '--webhook-url', 'http://app/eval'])).rejects.toThrow('__exit_1');
  });

  it('requires --agent-id and --webhook-url for dataset-run mode', async () => {
    routeFetch({});
    await expect(runEvalGateCommand(['--url', 'http://lens', '--dataset-id', 'ds1'])).rejects.toThrow('__exit_1');
  });

  it('PASSES exactly at the threshold (passRate == threshold)', async () => {
    routeFetch({
      'POST /api/eval/runs': () => jsonRes({ id: 'run1' }),
      'GET /api/eval/runs/': () => jsonRes({ status: 'completed', totalCases: 10, passedCases: 8 }), // 0.8
    });
    await runEvalGateCommand(['--url', 'http://lens', '--dataset-id', 'ds1', '--agent-id', 'a', '--webhook-url', 'http://app/eval', '--min-pass-rate', '0.8']);
    expect(out.join('\n')).toContain('PASS');
  });

  it('FAILS an empty dataset (totalCases=0 → 0% pass-rate)', async () => {
    routeFetch({
      'POST /api/eval/runs': () => jsonRes({ id: 'run1' }),
      'GET /api/eval/runs/': () => jsonRes({ status: 'completed', totalCases: 0, passedCases: 0 }),
    });
    await expect(runEvalGateCommand(['--url', 'http://lens', '--dataset-id', 'ds1', '--agent-id', 'a', '--webhook-url', 'http://app/eval'])).rejects.toThrow('__exit_1');
  });

  it('polls until the run completes (pending → completed)', async () => {
    let n = 0;
    routeFetch({
      'POST /api/eval/runs': () => jsonRes({ id: 'run1' }),
      'GET /api/eval/runs/': () => (++n < 2 ? jsonRes({ status: 'running' }) : jsonRes({ status: 'completed', totalCases: 2, passedCases: 2 })),
    });
    await runEvalGateCommand(['--url', 'http://lens', '--dataset-id', 'ds1', '--agent-id', 'a', '--webhook-url', 'http://app/eval', '--poll-interval', '0.01']);
    expect(n).toBeGreaterThanOrEqual(2);
    expect(out.join('\n')).toContain('PASS');
  });

  it('rejects an invalid --timeout-seconds (no infinite loop)', async () => {
    routeFetch({ 'POST /api/eval/runs': () => jsonRes({ id: 'run1' }) });
    await expect(runEvalGateCommand(['--url', 'http://lens', '--dataset-id', 'ds1', '--agent-id', 'a', '--webhook-url', 'http://app/eval', '--timeout-seconds', 'abc'])).rejects.toThrow('__exit_1');
  });
});

describe('eval-gate — input validation', () => {
  it('rejects an out-of-range --min-pass-rate', async () => {
    routeFetch({});
    await expect(runEvalGateCommand(['--url', 'http://lens', '--evaluator-id', 'ev1', '--session-ids', 's1', '--min-pass-rate', '1.5'])).rejects.toThrow('__exit_1');
  });
});

describe('eval-gate — mode selection', () => {
  it('errors when neither --dataset-id nor --evaluator-id is given', async () => {
    routeFetch({});
    await expect(runEvalGateCommand(['--url', 'http://lens'])).rejects.toThrow('__exit_1');
  });
});
