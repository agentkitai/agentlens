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
import type { AgentLensEvent, IEventStore, ScorerConfig } from '@agentkitai/agentlens-core';
import { type AnyDb, dbRun, dbGet } from '../../db/dialect-db.js';
import { RegexScorer } from './scorers/regex.js';
import type { IScorer } from './scorers/index.js';
import { appendEventToSession } from '../append-event.js';

export interface LiveEvalConfig {
  enabled: boolean;
  samplingRate: number; // 0..1
  scorerType: string;
  scorerConfig: ScorerConfig;
}

const SCORERS: Record<string, IScorer> = { regex: new RegexScorer() };

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

/**
 * Maybe score a completed session per the tenant's live-eval config. Returns true
 * if an eval_result was written. `rng` is injectable for deterministic sampling.
 */
export async function runLiveEval(
  args: { tenantId: string; sessionId: string; agentId: string; store: IEventStore; config: LiveEvalConfig; rng?: () => number },
): Promise<boolean> {
  const { config, store } = args;
  if (!config.enabled || (args.rng ?? Math.random)() >= config.samplingRate) return false;
  const scorer = SCORERS[config.scorerType];
  if (!scorer) return false;

  const events = await store.getSessionTimeline(args.sessionId);
  const output = lastModelOutput(events);
  if (output == null) return false;

  const result = await scorer.score({ testCase: {} as never, actualOutput: output, config: config.scorerConfig });
  await appendEventToSession(store, {
    tenantId: args.tenantId,
    sessionId: args.sessionId,
    agentId: args.agentId,
    eventType: 'eval_result',
    severity: result.passed ? 'info' : 'warn',
    payload: { method: 'deterministic', scorerType: result.scorerType, score: result.score, passed: result.passed, reasoning: result.reasoning },
    metadata: { source: 'live_eval' },
  });
  return true;
}
