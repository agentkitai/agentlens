/**
 * Shared human-score emission (#122) — used by both the human-score endpoint
 * and the annotation-queue submit path, so a review produces exactly one
 * consistent, identity-stamped, chained `human_score` event.
 */
import type { AgentLensEvent, HumanScorePayload, IEventStore } from '@agentkitai/agentlens-core';
import { appendEventToSession } from './append-event.js';

export interface AnnotatorIdentity {
  annotatorAgentId?: string;
  annotatorMethod?: string;
  annotatorUserId?: string;
  annotatorRole?: string;
}

export interface HumanScoreInput {
  score?: number;
  verdict?: string;
  passed?: boolean;
  reasoning?: string;
  labels?: string[];
  evaluatorId?: string;
  traceId?: string;
  queueItemId?: string;
}

/** Derive pass/fail when not explicitly given: from score (≥0.5) or a positive verdict word. */
export function deriveHumanPass(d: { passed?: boolean; score?: number; verdict?: string }): boolean | undefined {
  if (d.passed !== undefined) return d.passed;
  if (d.score !== undefined) return d.score >= 0.5;
  if (d.verdict) return /pass|approve|accept|good|yes/i.test(d.verdict);
  return undefined;
}

export async function recordHumanScore(
  store: IEventStore,
  args: {
    tenantId: string;
    sessionId: string;
    agentId: string;
    /** Session's verified agent id, stamped for pack/analytics attribution. */
    verifiedAgentId?: string;
    /** Record-integrity only (OTLP/unchained session). */
    unchained: boolean;
    annotator: AnnotatorIdentity;
    input: HumanScoreInput;
  },
): Promise<{ event: AgentLensEvent; passed: boolean | undefined }> {
  const d = args.input;
  const passed = deriveHumanPass(d);

  const payload: HumanScorePayload = {
    method: 'human',
    ...(d.score !== undefined ? { score: d.score } : {}),
    ...(d.verdict ? { verdict: d.verdict } : {}),
    ...(passed !== undefined ? { passed } : {}),
    ...(d.reasoning ? { reasoning: d.reasoning } : {}),
    ...(d.labels ? { labels: d.labels } : {}),
    ...(d.evaluatorId ? { evaluatorId: d.evaluatorId } : {}),
    ...(d.traceId ? { traceId: d.traceId } : {}),
    ...(d.queueItemId ? { queueItemId: d.queueItemId } : {}),
    ...args.annotator,
  };

  const event = await appendEventToSession(store, {
    tenantId: args.tenantId,
    sessionId: args.sessionId,
    agentId: args.agentId,
    eventType: 'human_score',
    severity: passed === false ? 'warn' : 'info',
    payload,
    metadata: { source: 'human_score', ...(args.verifiedAgentId ? { verifiedAgentId: args.verifiedAgentId } : {}) },
    unchained: args.unchained,
  });

  return { event, passed };
}
