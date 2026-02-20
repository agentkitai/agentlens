/**
 * AgentLens Relay Service v5
 *
 * Subscribes to OpenClaw's internal diagnostic event system for comprehensive telemetry:
 * - model.usage → LLM call tracking (tokens, cost, duration, per-agent)
 * - session.state → Session lifecycle (idle/processing/waiting)
 * - message.processed → Message handling outcomes
 * - run.attempt → Agent run tracking
 * - session.stuck → Stuck session alerts
 * - diagnostic.heartbeat → System health
 *
 * ALSO wraps globalThis.fetch for Anthropic API calls to capture:
 * - Prompt content (request body)
 * - Tool calls (response body)
 *
 * Combined: full observability of all agents (main + sub-agents like BMAD pm/dev/qa).
 */
import type { OpenClawPluginService, DiagnosticEventPayload } from "openclaw/plugin-sdk";
import { onDiagnosticEvent } from "openclaw/plugin-sdk";
import http from "node:http";
import fs from "node:fs";

const AGENTLENS_URL = process.env.AGENTLENS_URL || "http://localhost:3000";
const AGENT_ID = process.env.AGENTLENS_AGENT_ID || "openclaw-brad";
const LOG_FILE = "/tmp/agentlens-relay-debug.log";

const MODEL_COSTS: Record<string, { input: number; output: number; cacheRead: number; cacheWrite: number }> = {
  "claude-opus-4-6":            { input: 15,   output: 75,  cacheRead: 1.5,  cacheWrite: 18.75 },
  "claude-sonnet-4":            { input: 3,    output: 15,  cacheRead: 0.3,  cacheWrite: 3.75 },
  "claude-haiku-4-5":           { input: 0.80, output: 4,   cacheRead: 0.08, cacheWrite: 1.0 },
  "claude-3-5-sonnet-20241022": { input: 3,    output: 15,  cacheRead: 0.3,  cacheWrite: 3.75 },
};

export function estimateCost(model: string, inputTokens: number, outputTokens: number, cacheRead: number, cacheWrite: number): number {
  const key = Object.keys(MODEL_COSTS).find(k => model.includes(k));
  if (!key) return 0;
  const c = MODEL_COSTS[key];
  const uncachedInput = Math.max(0, inputTokens - cacheRead - cacheWrite);
  return (uncachedInput * c.input + outputTokens * c.output + cacheRead * c.cacheRead + cacheWrite * c.cacheWrite) / 1_000_000;
}

// ── Event batching ───────────────────────────────────────────────────

let eventBuffer: Record<string, unknown>[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;
const FLUSH_INTERVAL = 2000; // 2 seconds
const FLUSH_MAX_BATCH = 50;

function enqueueEvent(event: Record<string, unknown>) {
  eventBuffer.push(event);
  if (eventBuffer.length >= FLUSH_MAX_BATCH) {
    flushEvents();
  } else if (!flushTimer) {
    flushTimer = setTimeout(flushEvents, FLUSH_INTERVAL);
  }
}

function flushEvents() {
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  if (eventBuffer.length === 0) return;
  const batch = eventBuffer;
  eventBuffer = [];
  postToAgentLens(batch, `batch(${batch.length})`);
}

function postToAgentLens(events: Record<string, unknown>[], label?: string) {
  const body = JSON.stringify({ events });
  const url = new URL(`${AGENTLENS_URL}/api/events`);
  try {
    const req = http.request(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Content-Length": String(Buffer.byteLength(body)) },
      timeout: 5000,
    }, (res) => {
      let data = "";
      res.on("data", (c: Buffer) => { data += c.toString(); });
      res.on("end", () => {
        if (res.statusCode && res.statusCode >= 400) {
          debugLog(`POST_ERROR[${label || "?"}]: ${res.statusCode} ${data.slice(0, 200)}`);
        } else {
          debugLog(`POST_OK[${label || "?"}]: ${res.statusCode} ${data.slice(0, 100)}`);
        }
      });
    });
    req.on("error", (err: Error) => { debugLog(`POST_NET_ERROR[${label || "?"}]: ${err.message}`); });
    req.write(body);
    req.end();
  } catch (err: any) {
    debugLog(`POST_THROW[${label || "?"}]: ${err.message}`);
  }
}

function debugLog(msg: string) {
  try { fs.appendFileSync(LOG_FILE, `${new Date().toISOString()} ${msg}\n`); } catch {}
}

// ── Diagnostic event → AgentLens event translation ───────────────────

export function resolveAgentId(sessionKey?: string): string {
  if (!sessionKey) return AGENT_ID;
  // Extract agent ID from session key format: "agent:<agentId>:<rest>"
  const match = sessionKey.match(/^agent:([^:]+)/);
  return match ? match[1] : AGENT_ID;
}

function handleModelUsage(evt: Extract<DiagnosticEventPayload, { type: "model.usage" }>) {
  const agentId = resolveAgentId(evt.sessionKey);
  const inputTokens = evt.usage.input || 0;
  const outputTokens = evt.usage.output || 0;
  const cacheRead = evt.usage.cacheRead || 0;
  const cacheWrite = evt.usage.cacheWrite || 0;
  const costUsd = evt.costUsd || estimateCost(evt.model || "", inputTokens, outputTokens, cacheRead, cacheWrite);

  enqueueEvent({
    sessionId: evt.sessionId || evt.sessionKey || "unknown",
    agentId,
    eventType: "llm_response",
    severity: "info",
    payload: {
      provider: evt.provider || "anthropic",
      model: evt.model || "unknown",
      usage: {
        inputTokens,
        outputTokens,
        totalTokens: evt.usage.total || (inputTokens + outputTokens),
        cacheReadTokens: cacheRead,
        cacheWriteTokens: cacheWrite,
        promptTokens: evt.usage.promptTokens || 0,
      },
      costUsd,
      latencyMs: evt.durationMs || 0,
      context: evt.context || null,
    },
    metadata: { source: "agentlens-relay-v5", channel: evt.channel },
  });

  debugLog(`DIAG[model.usage]: ${agentId} | ${evt.model} | ${inputTokens}in/${outputTokens}out | $${costUsd.toFixed(4)} | ${evt.durationMs}ms`);
}

function handleSessionState(evt: Extract<DiagnosticEventPayload, { type: "session.state" }>) {
  const agentId = resolveAgentId(evt.sessionKey);
  enqueueEvent({
    sessionId: evt.sessionId || evt.sessionKey || "unknown",
    agentId,
    eventType: "session_state",
    severity: "info",
    payload: {
      state: evt.state,
      prevState: evt.prevState || null,
      reason: evt.reason || null,
      queueDepth: evt.queueDepth || 0,
    },
    metadata: { source: "agentlens-relay-v5" },
  });
}

function handleMessageProcessed(evt: Extract<DiagnosticEventPayload, { type: "message.processed" }>) {
  const agentId = resolveAgentId(evt.sessionKey);
  enqueueEvent({
    sessionId: evt.sessionId || evt.sessionKey || "unknown",
    agentId,
    eventType: "message_processed",
    severity: evt.outcome === "error" ? "error" : "info",
    payload: {
      channel: evt.channel,
      outcome: evt.outcome,
      reason: evt.reason || null,
      error: evt.error || null,
      durationMs: evt.durationMs || 0,
      messageId: evt.messageId || null,
      chatId: evt.chatId || null,
    },
    metadata: { source: "agentlens-relay-v5" },
  });
}

function handleRunAttempt(evt: Extract<DiagnosticEventPayload, { type: "run.attempt" }>) {
  const agentId = resolveAgentId(evt.sessionKey);
  enqueueEvent({
    sessionId: evt.sessionId || evt.sessionKey || "unknown",
    agentId,
    eventType: "run_attempt",
    severity: "info",
    payload: {
      runId: evt.runId,
      attempt: evt.attempt,
    },
    metadata: { source: "agentlens-relay-v5" },
  });
}

function handleSessionStuck(evt: Extract<DiagnosticEventPayload, { type: "session.stuck" }>) {
  const agentId = resolveAgentId(evt.sessionKey);
  enqueueEvent({
    sessionId: evt.sessionId || evt.sessionKey || "unknown",
    agentId,
    eventType: "session_stuck",
    severity: "warning",
    payload: {
      state: evt.state,
      ageMs: evt.ageMs,
      queueDepth: evt.queueDepth || 0,
    },
    metadata: { source: "agentlens-relay-v5" },
  });

  debugLog(`DIAG[session.stuck]: ${agentId} | age=${evt.ageMs}ms | queue=${evt.queueDepth}`);
}

function handleHeartbeat(evt: Extract<DiagnosticEventPayload, { type: "diagnostic.heartbeat" }>) {
  enqueueEvent({
    sessionId: "system",
    agentId: AGENT_ID,
    eventType: "system_heartbeat",
    severity: "info",
    payload: {
      webhooks: evt.webhooks,
      activeSessions: evt.active,
      waitingSessions: evt.waiting,
      queuedMessages: evt.queued,
    },
    metadata: { source: "agentlens-relay-v5" },
  });
}

function handleMessageQueued(evt: Extract<DiagnosticEventPayload, { type: "message.queued" }>) {
  const agentId = resolveAgentId(evt.sessionKey);
  enqueueEvent({
    sessionId: evt.sessionId || evt.sessionKey || "unknown",
    agentId,
    eventType: "message_queued",
    severity: "info",
    payload: {
      channel: evt.channel || "unknown",
      source: evt.source,
      queueDepth: evt.queueDepth || 0,
    },
    metadata: { source: "agentlens-relay-v5" },
  });
}

// ── Fetch wrapper for prompt/tool capture ────────────────────────────

function extractPromptPreview(messages: any[]): string {
  if (!Array.isArray(messages)) return "";
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m?.role === "user") {
      const content = typeof m.content === "string"
        ? m.content
        : Array.isArray(m.content)
          ? m.content.filter((b: any) => b.type === "text").map((b: any) => b.text).join(" ")
          : "";
      return content.slice(0, 500);
    }
  }
  return "";
}

export function extractToolCalls(responseBody: string): Array<{ toolName: string; toolCallId: string }> {
  const tools: Array<{ toolName: string; toolCallId: string }> = [];
  for (const line of responseBody.split("\n")) {
    if (!line.startsWith("data:")) continue;
    try {
      const data = JSON.parse(line.replace(/^data:\s*/, ""));
      if (data.type === "content_block_start" && data.content_block?.type === "tool_use") {
        tools.push({
          toolName: data.content_block.name || "unknown",
          toolCallId: data.content_block.id || "",
        });
      }
    } catch {}
  }
  return tools;
}

let origFetch: typeof globalThis.fetch | null = null;

export function createAgentLensRelayService(): OpenClawPluginService {
  let unsubscribe: (() => void) | null = null;

  return {
    id: "agentlens-relay",

    async start(ctx) {
      ctx.logger.info("agentlens-relay v5: starting (diagnostic events + fetch wrapper)");
      fs.writeFileSync(LOG_FILE, `=== agentlens-relay v5 started ${new Date().toISOString()} ===\n`);

      // ── Subscribe to OpenClaw diagnostic events ──────────────────
      unsubscribe = onDiagnosticEvent((evt: DiagnosticEventPayload) => {
        switch (evt.type) {
          case "model.usage":
            handleModelUsage(evt);
            break;
          case "session.state":
            handleSessionState(evt);
            break;
          case "message.processed":
            handleMessageProcessed(evt);
            break;
          case "message.queued":
            handleMessageQueued(evt);
            break;
          case "run.attempt":
            handleRunAttempt(evt);
            break;
          case "session.stuck":
            handleSessionStuck(evt);
            break;
          case "diagnostic.heartbeat":
            handleHeartbeat(evt);
            break;
          // queue.lane events are too noisy for AgentLens, skip them
        }
      });

      debugLog("Subscribed to OpenClaw diagnostic events ✅");
      ctx.logger.info("agentlens-relay v5: diagnostic event subscription active");

      // ── Wrap fetch for prompt/tool capture ──────────────────────
      origFetch = globalThis.fetch;
      const anyFetch = origFetch as any;
      if (anyFetch?.name === "patchedFetch" && typeof anyFetch.__origFetch === "function") {
        origFetch = anyFetch.__origFetch;
        debugLog("Unwrapped preload patchedFetch to get original fetch");
      }

      const savedFetch = origFetch;

      globalThis.fetch = async function agentlensRelayFetch(input: any, init?: any): Promise<Response> {
        const url = typeof input === "string" ? input : (input instanceof URL ? input.href : input?.url || "");

        if (!url.includes("api.anthropic.com")) {
          return savedFetch!.call(this, input, init);
        }

        const startTime = Date.now();
        const callId = `relay-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

        // Parse request body for prompt info
        let requestBody: any = null;
        let promptPreview = "";
        let model = "";
        let systemPrompt = "";
        try {
          const bodyStr = typeof init?.body === "string" ? init.body : "";
          if (bodyStr) {
            requestBody = JSON.parse(bodyStr);
            model = requestBody.model || "";
            promptPreview = extractPromptPreview(requestBody.messages || []);
            if (typeof requestBody.system === "string") {
              systemPrompt = requestBody.system.slice(0, 200);
            } else if (Array.isArray(requestBody.system)) {
              systemPrompt = requestBody.system
                .filter((b: any) => b.type === "text")
                .map((b: any) => b.text)
                .join(" ")
                .slice(0, 200);
            }
          }
        } catch {}

        // Post llm_call event with prompt content
        enqueueEvent({
          sessionId: "openclaw-main",
          agentId: AGENT_ID,
          eventType: "llm_call",
          severity: "info",
          payload: {
            callId,
            provider: "anthropic",
            model,
            messages: [{ role: "user", content: promptPreview || "(no prompt)" }],
            systemPromptPreview: systemPrompt,
            messageCount: requestBody?.messages?.length || 0,
            maxTokens: requestBody?.max_tokens || null,
            stream: requestBody?.stream ?? false,
            toolNames: requestBody?.tools?.map((t: any) => t.name) || [],
            toolCount: requestBody?.tools?.length || 0,
          },
          metadata: { source: "agentlens-relay-v5" },
        });

        const response = await savedFetch!.call(this, input, init);

        // Tee response for tool call extraction
        const origBody = response.body;
        if (origBody) {
          const chunks: Uint8Array[] = [];
          const [stream1, stream2] = origBody.tee();
          Object.defineProperty(response, "body", { value: stream1, writable: true });

          (async () => {
            try {
              const reader = stream2.getReader();
              while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                if (value) chunks.push(value);
              }
              const bodyText = Buffer.concat(chunks.map(c => Buffer.from(c))).toString("utf-8");

              // Extract tool calls from streaming response
              const toolCalls = extractToolCalls(bodyText);
              if (toolCalls.length > 0) {
                for (const tc of toolCalls) {
                  enqueueEvent({
                    sessionId: "openclaw-main",
                    agentId: AGENT_ID,
                    eventType: "tool_call",
                    severity: "info",
                    payload: {
                      callId,
                      toolName: tc.toolName,
                      toolCallId: tc.toolCallId,
                    },
                    metadata: { source: "agentlens-relay-v5" },
                  });
                }
                debugLog(`TOOLS: ${toolCalls.map(t => t.toolName).join(", ")}`);
              }
            } catch (err: any) {
              debugLog(`ERROR reading response: ${err.message}`);
            }
          })();
        }

        return response;
      };

      debugLog("globalThis.fetch wrapped successfully ✅");
      ctx.logger.info("agentlens-relay v5: fetch wrapped for prompt capture");

      // Announce startup
      enqueueEvent({
        sessionId: "system",
        agentId: AGENT_ID,
        eventType: "custom",
        severity: "info",
        payload: { type: "relay_v5_started", data: { ts: new Date().toISOString() } },
        metadata: { source: "agentlens-relay-v5" },
      });
    },

    async stop() {
      // Flush remaining events
      flushEvents();

      // Unsubscribe from diagnostic events
      if (unsubscribe) {
        unsubscribe();
        unsubscribe = null;
      }

      // Restore original fetch
      if (origFetch) {
        globalThis.fetch = origFetch;
        origFetch = null;
      }
    },
  };
}
