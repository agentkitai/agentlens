/**
 * AgentLens Relay Service v5 — Hook-based
 *
 * Uses OpenClaw's plugin hook API (`api.on`) instead of fetch interception.
 * This correctly captures subagent LLM calls and delegations.
 */
import type {
  OpenClawPluginApi,
  PluginHookBeforeAgentStartEvent,
  PluginHookAgentContext,
  PluginHookAgentEndEvent,
  PluginHookBeforeToolCallEvent,
  PluginHookToolContext,
  PluginHookAfterToolCallEvent,
} from "openclaw/plugin-sdk";
import http from "node:http";
import crypto from "node:crypto";
import fs from "node:fs";

const AGENTLENS_URL = process.env.AGENTLENS_URL || "http://localhost:3000";
const DEFAULT_AGENT_ID = process.env.AGENTLENS_AGENT_ID || "openclaw-brad";
const MESH_URL = process.env.MESH_URL || "http://localhost:8766";
const LOG_FILE = "/tmp/agentlens-relay-debug.log";

// ── Cost estimation (kept from v4) ──────────────────────────────────────────

const MODEL_COSTS: Record<string, { input: number; output: number; cacheRead: number; cacheWrite: number }> = {
  "claude-opus-4-6":            { input: 15,   output: 75,  cacheRead: 1.5,  cacheWrite: 18.75 },
  "claude-sonnet-4":            { input: 3,    output: 15,  cacheRead: 0.3,  cacheWrite: 3.75 },
  "claude-haiku-4-5":           { input: 0.80, output: 4,   cacheRead: 0.08, cacheWrite: 1.0 },
  "claude-3-5-sonnet-20241022": { input: 3,    output: 15,  cacheRead: 0.3,  cacheWrite: 3.75 },
};

function estimateCost(model: string, inputTokens: number, outputTokens: number, cacheRead: number, cacheWrite: number): number {
  const key = Object.keys(MODEL_COSTS).find(k => model.includes(k));
  if (!key) return 0;
  const c = MODEL_COSTS[key];
  const uncachedInput = Math.max(0, inputTokens - cacheRead - cacheWrite);
  return (uncachedInput * c.input + outputTokens * c.output + cacheRead * c.cacheRead + cacheWrite * c.cacheWrite) / 1_000_000;
}

// ── Delegation tracking (kept from v4) ──────────────────────────────────────

const activeDelegations = new Map<string, string>();

// Map subagent sessionKey prefix → label from sessions_spawn
// e.g., "agent:main:subagent:" → "relay-test"
const spawnLabels = new Map<string, string>();

function postDelegationToMesh(delegationId: string, sourceAgent: string, targetAgent: string, task: string) {
  const body = JSON.stringify({
    id: delegationId,
    source_agent: sourceAgent,
    target_agent: targetAgent,
    task: task.slice(0, 500),
    status: "completed",
    latency_ms: null,
  });
  const url = new URL(`${MESH_URL}/v1/delegations`);
  try {
    const req = http.request(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Content-Length": String(Buffer.byteLength(body)) },
      timeout: 3000,
    }, (res) => {
      let data = "";
      res.on("data", (c: Buffer) => { data += c.toString(); });
      res.on("end", () => { debugLog(`MESH_DELEGATION[${res.statusCode}]: ${data.slice(0, 100)}`); });
    });
    req.on("error", (err: Error) => { debugLog(`MESH_DELEGATION_ERROR: ${err.message}`); });
    req.write(body);
    req.end();
  } catch (err: any) {
    debugLog(`MESH_DELEGATION_THROW: ${err.message}`);
  }
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function debugLog(msg: string) {
  try { fs.appendFileSync(LOG_FILE, `${new Date().toISOString()} ${msg}\n`); } catch {}
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

function deriveAgentInfo(ctx: PluginHookAgentContext): { agentId: string; sessionId: string; label?: string } {
  const sessionKey = ctx.sessionKey || "";
  const agentId = ctx.agentId || DEFAULT_AGENT_ID;

  // sessionKey format: "agent:main:main" or "agent:bmad-dev:subagent:<uuid>"
  const isSubagent = sessionKey.includes(":subagent:");

  // Check if we have a spawn label for this subagent
  let label: string | undefined;
  if (isSubagent) {
    // First try exact match (from after_tool_call mapping)
    label = spawnLabels.get(sessionKey);
    // Fall back to pending label (before after_tool_call returns)
    if (!label) {
      for (const [k, lbl] of spawnLabels) {
        if (k.startsWith("pending:")) {
          label = lbl;
          // Map it now for future lookups
          spawnLabels.set(sessionKey, lbl);
          spawnLabels.delete(k);
          break;
        }
      }
    }
  }

  // Always use the real agentId for identity; label is just metadata
  const sessionId = isSubagent
    ? `openclaw-subagent-${agentId}${label ? `-${label}` : ""}`
    : `openclaw-${agentId}`;

  return { agentId, sessionId, label };
}

function extractPromptPreview(messages: unknown[]): string {
  if (!Array.isArray(messages)) return "";
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i] as any;
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

/**
 * Extract cumulative usage from the messages array.
 * Assistant messages from Anthropic SDK include a `usage` property.
 */
function extractUsageFromMessages(messages: unknown[]): {
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheRead: number;
  cacheWrite: number;
} {
  let inputTokens = 0;
  let outputTokens = 0;
  let cacheRead = 0;
  let cacheWrite = 0;
  let model = "";

  if (!Array.isArray(messages)) return { model, inputTokens, outputTokens, cacheRead, cacheWrite };

  for (const m of messages) {
    const msg = m as any;
    if (msg?.role !== "assistant") continue;

    // Try to get model from assistant message
    if (msg.model) model = msg.model;

    const u = msg.usage;
    if (!u) continue;

    inputTokens += u.input_tokens ?? u.inputTokens ?? u.input ?? 0;
    outputTokens += u.output_tokens ?? u.outputTokens ?? u.output ?? 0;
    cacheRead += u.cache_read_input_tokens ?? u.cacheRead ?? u.cache_read ?? 0;
    cacheWrite += u.cache_creation_input_tokens ?? u.cacheWrite ?? u.cache_write ?? 0;
  }

  return { model, inputTokens, outputTokens, cacheRead, cacheWrite };
}

// ── Per-run state to correlate before_agent_start with agent_end ────────────

interface RunState {
  callId: string;
  promptPreview: string;
  startTime: number;
  toolCalls: string[];
}

// Key: sessionKey (unique per concurrent run)
const activeRuns = new Map<string, RunState>();

// ── Hook registration ───────────────────────────────────────────────────────

export function registerAgentLensHooks(api: OpenClawPluginApi) {
  fs.writeFileSync(LOG_FILE, `=== agentlens-relay v5 (hooks) started ${new Date().toISOString()} ===\n`);
  api.logger.info("agentlens-relay v5: registering hooks");

  // Notify AgentLens that we started
  postToAgentLens([{
    sessionId: "openclaw-main",
    agentId: DEFAULT_AGENT_ID,
    eventType: "custom",
    severity: "info",
    payload: { type: "relay_v5_started", data: { ts: new Date().toISOString(), method: "hooks" } },
    metadata: { source: "agentlens-relay" },
  }]);

  // ── before_agent_start: emit llm_call ─────────────────────────────────

  api.on("before_agent_start", (event: PluginHookBeforeAgentStartEvent, ctx: PluginHookAgentContext) => {
    const { agentId, sessionId } = deriveAgentInfo(ctx);
    const callId = `hook-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const promptPreview = event.prompt?.slice(0, 500) || extractPromptPreview(event.messages as unknown[] || []);
    const messageCount = Array.isArray(event.messages) ? event.messages.length : 0;

    // Store run state for correlation with agent_end
    const key = ctx.sessionKey || ctx.sessionId || callId;
    activeRuns.set(key, {
      callId,
      promptPreview,
      startTime: Date.now(),
      toolCalls: [],
    });

    debugLog(`HOOK[before_agent_start] agent=${agentId} session=${sessionId} prompt=${promptPreview.slice(0, 80)}...`);

    postToAgentLens([{
      sessionId,
      agentId,
      eventType: "llm_call",
      severity: "info",
      payload: {
        callId,
        provider: "anthropic",
        model: "(pending)", // model not known until response
        messages: [{ role: "user", content: promptPreview || "(no prompt)" }],
        messageCount,
        stream: true,
        toolNames: [],
        toolCount: 0,
      },
      metadata: { source: "agentlens-relay" },
    }], "llm_call");
  });

  // ── agent_end: emit llm_response with usage ──────────────────────────

  api.on("agent_end", (event: PluginHookAgentEndEvent, ctx: PluginHookAgentContext) => {
    const { agentId, sessionId } = deriveAgentInfo(ctx);
    const key = ctx.sessionKey || ctx.sessionId || "";
    const run = activeRuns.get(key);
    const callId = run?.callId || `hook-end-${Date.now()}`;
    const durationMs = event.durationMs ?? (run ? Date.now() - run.startTime : 0);

    // Extract usage from the messages array
    const usage = extractUsageFromMessages(event.messages as unknown[] || []);
    const costUsd = estimateCost(
      usage.model,
      usage.inputTokens,
      usage.outputTokens,
      usage.cacheRead,
      usage.cacheWrite,
    );

    debugLog(`HOOK[agent_end] agent=${agentId} model=${usage.model} ${usage.inputTokens}in/${usage.outputTokens}out $${costUsd.toFixed(4)} ${durationMs}ms tools=${run?.toolCalls.length || 0}`);

    const events: Record<string, unknown>[] = [{
      sessionId,
      agentId,
      eventType: "llm_response",
      severity: "info",
      payload: {
        callId,
        provider: "anthropic",
        model: usage.model || "(unknown)",
        completion: "(hook-captured)",
        finishReason: event.success ? "end_turn" : "error",
        usage: {
          inputTokens: usage.inputTokens,
          outputTokens: usage.outputTokens,
          totalTokens: usage.inputTokens + usage.outputTokens,
          cacheReadTokens: usage.cacheRead,
          cacheWriteTokens: usage.cacheWrite,
        },
        costUsd,
        latencyMs: durationMs,
        toolCallCount: run?.toolCalls.length || 0,
      },
      metadata: { source: "agentlens-relay" },
    }];

    postToAgentLens(events, "llm_response");

    // Clean up
    activeRuns.delete(key);
  });

  // ── before_tool_call: detect delegations (sessions_spawn) ─────────────

  api.on("before_tool_call", (event: PluginHookBeforeToolCallEvent, ctx: PluginHookToolContext) => {
    const { agentId, sessionId } = deriveAgentInfo(ctx as unknown as PluginHookAgentContext);

    // Track tool calls for the active run
    const key = ctx.sessionKey || "";
    const run = activeRuns.get(key);
    if (run) {
      run.toolCalls.push(event.toolName);
    }

    // Detect delegation via sessions_spawn
    if (event.toolName === "sessions_spawn" || event.toolName === "session_spawn") {
      const params = event.params || {};
      const spawnLabel = (params as any).label;
      const spawnAgentId = (params as any).agentId;
      // targetAgent should be the actual agent ID, not the session label
      const targetAgent = spawnAgentId || "subagent";
      const task = (params as any).task || (params as any).message || (params as any).prompt || "";

      // Pre-register the label — we'll match it when the subagent starts
      // The child sessionKey will be agent:<agentId>:subagent:<uuid>
      // We don't know the UUID yet, but we can match by agentId prefix
      if (spawnLabel) {
        const parentAgentId = agentId === DEFAULT_AGENT_ID ? "main" : agentId;
        spawnLabels.set(`pending:${spawnLabel}`, spawnLabel);
        debugLog(`SPAWN_LABEL_REGISTERED: ${spawnLabel} (from ${parentAgentId})`);
      }
      const taskStr = typeof task === "string" ? task : JSON.stringify(task);

      const delegationKey = `${agentId}:${targetAgent}:${taskStr.slice(0, 100)}`;
      if (!activeDelegations.has(delegationKey)) {
        const delegationId = crypto.randomUUID();
        activeDelegations.set(delegationKey, delegationId);

        debugLog(`HOOK[delegation] ${agentId} -> ${targetAgent}${spawnLabel ? ` (label: ${spawnLabel})` : ""}: ${taskStr.slice(0, 80)}`);

        postToAgentLens([{
          sessionId,
          agentId,
          eventType: "custom",
          severity: "info",
          payload: {
            type: "delegation_start",
            data: {
              sourceAgent: agentId,
              targetAgent,
              label: spawnLabel || undefined,
              task: taskStr.slice(0, 200),
              ts: new Date().toISOString(),
            },
          },
          metadata: { source: "agentlens-relay" },
        }], "delegation_start");

        postDelegationToMesh(delegationId, agentId, targetAgent, taskStr || "(delegation)");
      }
    }
  });

  // ── after_tool_call: emit tool_call events ────────────────────────────

  api.on("after_tool_call", (event: PluginHookAfterToolCallEvent, ctx: PluginHookToolContext) => {
    const { agentId, sessionId } = deriveAgentInfo(ctx as unknown as PluginHookAgentContext);
    const key = ctx.sessionKey || "";
    const run = activeRuns.get(key);
    const callId = run?.callId || `hook-tool-${Date.now()}`;

    // Capture child session key from sessions_spawn result → map to label
    if (event.toolName === "sessions_spawn" || event.toolName === "session_spawn") {
      try {
        const result = typeof event.result === "string" ? JSON.parse(event.result) : event.result;
        const childKey = result?.childSessionKey;
        if (childKey) {
          // Find the pending label
          for (const [k, label] of spawnLabels) {
            if (k.startsWith("pending:")) {
              spawnLabels.delete(k);
              spawnLabels.set(childKey, label);
              debugLog(`SPAWN_LABEL_MAPPED: ${childKey} → ${label}`);
              break;
            }
          }
        }
      } catch {}
    }

    debugLog(`HOOK[after_tool_call] agent=${agentId} tool=${event.toolName} ${event.durationMs || 0}ms`);

    postToAgentLens([{
      sessionId,
      agentId,
      eventType: "tool_call",
      severity: "info",
      payload: {
        callId,
        toolName: event.toolName,
        arguments: event.params || {},
        result: event.result ? String(event.result).slice(0, 500) : undefined,
        durationMs: event.durationMs || 0,
        error: event.error || undefined,
      },
      metadata: { source: "agentlens-relay" },
    }], "tool_call");
  });

  api.logger.info("agentlens-relay v5: hooks registered ✅");
}
