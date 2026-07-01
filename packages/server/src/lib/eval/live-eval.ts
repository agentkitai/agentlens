/**
 * LiveEvalEngine (#254) — online eval over a sampled fraction of live traffic.
 *
 * When enabled for a tenant, a fraction of completed sessions are sampled and the
 * last model output is scored (currently the deterministic regex scorer — no
 * ground truth needed). The score is written back as a chained `eval_result`
 * event (method: 'live_eval'), the same tamper-evident evidence trail as offline
 * evals. Additional scorer types are a follow-up; this wires one end-to-end.
 */
import { sql } from 'drizzle-orm';
import type { AgentLensEvent, EvalTestCase, IEventStore, ScorerConfig, ScorerType } from '@agentkitai/agentlens-core';
import { type AnyDb, dbRun, dbGet } from '../../db/dialect-db.js';
import { createDefaultRegistry } from './index.js';
import type { ScorerRegistry } from './scorers/index.js';
import { appendEventToSession } from '../append-event.js';

export interface LiveEvalConfig {
  enabled: boolean;
  samplingRate: number; // 0..1
  scorerType: string;
  scorerConfig: ScorerConfig;
}

// All built-in scorers (regex/contains/exact_match/llm_judge). The judge is
// wired to the env-configured LLM and degrades to a clear "not configured" result.
const defaultRegistry = createDefaultRegistry();

// Budget: cap live LLM-judge calls per tenant per hour (in-memory; per-process —
// the sampling rate is the primary lever, this is a hard ceiling on top of it).
const LLM_CALL_CAP = Number(process.env['AGENTLENS_LIVE_EVAL_LLM_CAP'] ?? 60);
const llmCallCounts = new Map<string, { hour: number; count: number }>();
function underLlmBudget(tenantId: string): boolean {
  const hour = Math.floor(Date.now() / 3_600_000);
  const e = llmCallCounts.get(tenantId);
  if (!e || e.hour !== hour) {
    llmCallCounts.set(tenantId, { hour, count: 1 });
    return true;
  }
  if (e.count >= LLM_CALL_CAP) return false;
  e.count++;
  return true;
}

export class LiveEvalStore {
  constructor(private readonly db: AnyDb) {}

  async get(tenantId: string): Promise<LiveEvalConfig | null> {
    const r = await dbGet<{ enabled: number; sampling_rate: number; scorer_type: string; scorer_config: string }>(
      this.db,
      sql`SELECT enabled, sampling_rate, scorer_type, scorer_config FROM live_eval_config WHERE tenant_id = ${tenantId}`,
    );
    return r
      ? { enabled: !!r.enabled, samplingRate: Number(r.sampling_rate), scorerType: r.scorer_type, scorerConfig: JSON.parse(r.scorer_config) }
      : null;
  }

  async set(tenantId: string, cfg: LiveEvalConfig): Promise<void> {
    const now = new Date().toISOString();
    await dbRun(
      this.db,
      sql`INSERT INTO live_eval_config (tenant_id, enabled, sampling_rate, scorer_type, scorer_config, updated_at)
          VALUES (${tenantId}, ${cfg.enabled ? 1 : 0}, ${cfg.samplingRate}, ${cfg.scorerType}, ${JSON.stringify(cfg.scorerConfig)}, ${now})
          ON CONFLICT (tenant_id) DO UPDATE SET
            enabled = excluded.enabled, sampling_rate = excluded.sampling_rate,
            scorer_type = excluded.scorer_type, scorer_config = excluded.scorer_config, updated_at = excluded.updated_at`,
    );
  }
}

function lastModelOutput(events: AgentLensEvent[]): unknown {
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i]!;
    if (e.eventType === 'llm_response') {
      const p = e.payload as Record<string, unknown>;
      return p.content ?? p.output ?? p.response ?? p.text ?? p;
    }
  }
  return null;
}

/** The last model input (for the llm-judge rubric context). */
function lastModelInput(events: AgentLensEvent[]): string {
  for (let i = events.length - 1; i >= 0; i--) {
    const p = events[i]!.payload as Record<string, unknown>;
    if (events[i]!.eventType === 'llm_call') {
      if (typeof p.systemPrompt === 'string' && p.systemPrompt) return p.systemPrompt;
      if (Array.isArray(p.messages)) {
        return (p.messages as Array<{ content?: unknown }>).map((m) => (typeof m?.content === 'string' ? m.content : JSON.stringify(m?.content))).join('\n');
      }
    }
  }
  return '';
}

/**
 * Maybe score a completed session per the tenant's live-eval config. Returns true
 * if an eval_result was written. `rng` is injectable for deterministic sampling.
 */
export async function runLiveEval(
  args: { tenantId: string; sessionId: string; agentId: string; store: IEventStore; config: LiveEvalConfig; rng?: () => number; registry?: ScorerRegistry },
): Promise<boolean> {
  const { config, store } = args;
  const registry = args.registry ?? defaultRegistry;
  if (!config.enabled || (args.rng ?? Math.random)() >= config.samplingRate) return false;
  const scorerType = ((config.scorerConfig as { type?: string })?.type ?? config.scorerType) as ScorerType;
  if (!registry.has(scorerType)) return false;
  // Budget: cap live LLM-judge calls per tenant per hour.
  if (scorerType === 'llm_judge' && !underLlmBudget(args.tenantId)) return false;

  const events = await store.getSessionTimeline(args.sessionId);
  const output = lastModelOutput(events);
  if (output == null) return false;

  const testCase = {
    id: 'live',
    datasetId: 'live',
    tenantId: args.tenantId,
    input: { prompt: lastModelInput(events) },
    expectedOutput: (config.scorerConfig as unknown as Record<string, unknown>).expected,
    scoringCriteria: (config.scorerConfig as unknown as Record<string, unknown>).rubric as string | undefined,
    createdAt: new Date().toISOString(),
  } as unknown as EvalTestCase;

  let result;
  try {
    result = await registry.score({ testCase, actualOutput: output, config: { ...config.scorerConfig, type: scorerType } });
  } catch {
    return false; // a misconfigured scorer shouldn't break ingest
  }

  await appendEventToSession(store, {
    tenantId: args.tenantId,
    sessionId: args.sessionId,
    agentId: args.agentId,
    eventType: 'eval_result',
    severity: result.passed ? 'info' : 'warn',
    payload: {
      method: result.scorerType === 'llm_judge' ? 'llm_judge' : 'deterministic',
      scorerType: result.scorerType,
      score: result.score,
      passed: result.passed,
      reasoning: result.reasoning,
    },
    metadata: { source: 'live_eval' },
  });
  return true;
}
