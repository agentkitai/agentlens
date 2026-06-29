/**
 * Drop-in instrumentation core (#123).
 *
 * `init()` configures a process-wide instrumentation singleton; provider
 * wrappers (`./openai`, `./vercel`) feed captured LLM calls into it. Each
 * capture computes per-call cost at capture time via `@agentkitai/pricing`,
 * carries the verified agent identity (via the client's `X-Agent-Token`), and is
 * sent through the chained `/api/events` ingest path. Captures are fail-safe:
 * they never throw into user code, and are tracked so `flush()`/`shutdown()` can
 * await them.
 */
import { randomUUID } from 'node:crypto';
import { costUsdDetailed } from '@agentkitai/pricing';
import type { LlmMessage } from '@agentkitai/agentlens-core';
import { AgentLensClient } from './client/AgentLensClient.js';

export interface InitConfig {
  /** Server URL (default: AGENTLENS_SERVER_URL env or http://localhost:3400). */
  url?: string;
  /** API key (default: AGENTLENS_API_KEY env). */
  apiKey?: string;
  /** Logical agent id for captured events (default: AGENTLENS_AGENT_ID env or 'default'). */
  agentId?: string;
  /** AgentGate agent token → server-verified `verifiedAgentId` (default: AGENTLENS_AGENT_TOKEN env). */
  agentToken?: string;
  /** AgentGate ingest key fallback (default: AGENTLENS_INGEST_KEY env). */
  agentIngestKey?: string;
  /** Session id to group captures (default: AGENTLENS_SESSION_ID env or a random ULID). */
  sessionId?: string;
  /** Strip prompt/completion content before sending. */
  redact?: boolean;
  /** Use a preconfigured client instead of url/apiKey. */
  client?: AgentLensClient;
  /** Called when a capture fails (default: silently swallowed). */
  onError?: (error: Error) => void;
}

export interface LlmCapture {
  provider: string;
  model: string;
  messages: LlmMessage[];
  systemPrompt?: string;
  completion: string | null;
  finishReason: string;
  usage: {
    inputTokens: number;
    outputTokens: number;
    totalTokens?: number;
    cacheReadTokens?: number;
    cacheWriteTokens?: number;
  };
  latencyMs: number;
  toolCalls?: Array<{ id: string; name: string; arguments: Record<string, unknown> }>;
  /** Pre-computed cost; if omitted it is computed from model + usage. */
  costUsd?: number;
}

export class Instrumentation {
  readonly client: AgentLensClient;
  readonly agentId: string;
  readonly sessionId: string;
  readonly redact: boolean;
  private readonly onError: (error: Error) => void;
  private readonly pending = new Set<Promise<void>>();

  constructor(config: InitConfig = {}) {
    this.client =
      config.client ??
      new AgentLensClient({
        url: config.url ?? process.env.AGENTLENS_SERVER_URL ?? 'http://localhost:3400',
        apiKey: config.apiKey ?? process.env.AGENTLENS_API_KEY,
        agentToken: config.agentToken ?? process.env.AGENTLENS_AGENT_TOKEN,
        agentIngestKey: config.agentIngestKey ?? process.env.AGENTLENS_INGEST_KEY,
        // We track + swallow errors ourselves so a capture never breaks user code.
        failOpen: false,
        // Telemetry is fail-fast: don't block flush retrying a failed capture.
        retry: { maxRetries: 1 },
      });
    this.agentId = config.agentId ?? process.env.AGENTLENS_AGENT_ID ?? 'default';
    this.sessionId = config.sessionId ?? process.env.AGENTLENS_SESSION_ID ?? randomUUID();
    this.redact = config.redact ?? false;
    this.onError = config.onError ?? (() => {});
  }

  /** Record a captured LLM call. Never throws; fire-and-forget but flushable. */
  capture(c: LlmCapture): void {
    const costUsd =
      c.costUsd ??
      costUsdDetailed(c.model, {
        inputTokens: c.usage.inputTokens,
        outputTokens: c.usage.outputTokens,
        cacheReadTokens: c.usage.cacheReadTokens,
        cacheWriteTokens: c.usage.cacheWriteTokens,
      }).costUsd;

    const p = (async () => {
      try {
        await this.client.logLlmCall(this.sessionId, this.agentId, {
          provider: c.provider,
          model: c.model,
          messages: c.messages,
          ...(c.systemPrompt !== undefined ? { systemPrompt: c.systemPrompt } : {}),
          completion: c.completion,
          finishReason: c.finishReason,
          usage: {
            inputTokens: c.usage.inputTokens,
            outputTokens: c.usage.outputTokens,
            totalTokens: c.usage.totalTokens ?? c.usage.inputTokens + c.usage.outputTokens,
          },
          costUsd,
          latencyMs: c.latencyMs,
          ...(c.toolCalls ? { toolCalls: c.toolCalls } : {}),
          redact: this.redact,
        });
      } catch (e) {
        this.onError(e instanceof Error ? e : new Error(String(e)));
      }
    })();
    this.pending.add(p);
    void p.finally(() => this.pending.delete(p));
  }

  /** Await all in-flight captures (call before process exit / in tests). */
  async flush(): Promise<void> {
    await Promise.all([...this.pending]);
  }
}

let active: Instrumentation | null = null;

/** Configure drop-in instrumentation. Returns the active instrumentation. */
export function init(config: InitConfig = {}): Instrumentation {
  active = new Instrumentation(config);
  return active;
}

export function getInstrumentation(): Instrumentation | null {
  return active;
}

/** Flush in-flight captures and clear the active instrumentation. */
export async function shutdown(): Promise<void> {
  if (active) await active.flush();
  active = null;
}
