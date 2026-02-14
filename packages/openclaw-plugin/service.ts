/**
 * AgentLens Relay Service v4
 * 
 * Wraps globalThis.fetch to intercept Anthropic API calls directly.
 * Captures request bodies (prompts) and response bodies (usage/tokens).
 * Posts structured events to AgentLens.
 */
import type { OpenClawPluginService } from "openclaw/plugin-sdk";
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

function estimateCost(model: string, inputTokens: number, outputTokens: number, cacheRead: number, cacheWrite: number): number {
  const key = Object.keys(MODEL_COSTS).find(k => model.includes(k));
  if (!key) return 0;
  const c = MODEL_COSTS[key];
  const uncachedInput = Math.max(0, inputTokens - cacheRead - cacheWrite);
  return (uncachedInput * c.input + outputTokens * c.output + cacheRead * c.cacheRead + cacheWrite * c.cacheWrite) / 1_000_000;
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
    debugLog(`POST_SENT[${label || "?"}]: ${body.length} bytes`);
  } catch (err: any) {
    debugLog(`POST_THROW[${label || "?"}]: ${err.message}`);
  }
}

function debugLog(msg: string) {
  try { fs.appendFileSync(LOG_FILE, `${new Date().toISOString()} ${msg}\n`); } catch {}
}

function extractPromptPreview(messages: any[]): string {
  if (!Array.isArray(messages)) return "";
  // Find the last user message
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

function extractToolCalls(responseBody: string): Array<{ toolName: string; toolCallId: string }> {
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
  return {
    id: "agentlens-relay",

    async start(ctx) {
      ctx.logger.info("agentlens-relay v4: wrapping globalThis.fetch for Anthropic interception");
      fs.writeFileSync(LOG_FILE, `=== agentlens-relay v4 started ${new Date().toISOString()} ===\n`);

      // Save original fetch (may already be wrapped by preload — unwrap if so)
      origFetch = globalThis.fetch;
      // If there's a preload wrapper, try to get the real fetch
      const anyFetch = origFetch as any;
      if (anyFetch?.name === "patchedFetch" && typeof anyFetch.__origFetch === "function") {
        origFetch = anyFetch.__origFetch;
        debugLog("Unwrapped preload patchedFetch to get original fetch");
      }

      const savedFetch = origFetch;

      globalThis.fetch = async function agentlensRelayFetch(input: any, init?: any): Promise<Response> {
        const url = typeof input === "string" ? input : (input instanceof URL ? input.href : input?.url || "");

        // Only intercept Anthropic API calls
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

        debugLog(`CALL: ${model} | prompt: ${promptPreview.slice(0, 80)}...`);

        // Post the llm_call event immediately (match AgentLens expected schema)
        postToAgentLens([{
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
          metadata: { source: "agentlens-relay" },
        }]);

        // Make the actual request
        const response = await savedFetch!.call(this, input, init);

        // Wrap the response body to tee the stream — clone() doesn't work well with SSE
        const origBody = response.body;
        if (origBody) {
          const chunks: Uint8Array[] = [];
          const [stream1, stream2] = origBody.tee();

          // Replace the response body with one branch
          Object.defineProperty(response, "body", { value: stream1, writable: true });

          // Read the other branch in the background for telemetry
          (async () => {
            try {
              const reader = stream2.getReader();
              while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                if (value) chunks.push(value);
              }
              const bodyText = Buffer.concat(chunks.map(c => Buffer.from(c))).toString("utf-8");
            const durationMs = Date.now() - startTime;

            let usage: any = null;
            let responseModel = model;
            let finishReason = "end_turn";

            if (bodyText.includes("event:")) {
              // SSE streaming response
              for (const line of bodyText.split("\n")) {
                if (!line.startsWith("data:")) continue;
                try {
                  const data = JSON.parse(line.replace(/^data:\s*/, ""));
                  if (data.type === "message_start" && data.message) {
                    responseModel = data.message.model || responseModel;
                    if (data.message.usage) usage = { ...(usage || {}), ...data.message.usage };
                  }
                  if (data.type === "message_delta") {
                    if (data.usage) usage = { ...(usage || {}), ...data.usage };
                    if (data.delta?.stop_reason) finishReason = data.delta.stop_reason;
                  }
                } catch {}
              }
            } else {
              // Non-streaming JSON response
              try {
                const j = JSON.parse(bodyText);
                responseModel = j.model || responseModel;
                usage = j.usage;
                finishReason = j.stop_reason || "end_turn";
              } catch {}
            }

            if (usage && (usage.input_tokens || usage.output_tokens)) {
              const inputTokens = usage.input_tokens || 0;
              const outputTokens = usage.output_tokens || 0;
              const cacheRead = usage.cache_read_input_tokens || 0;
              const cacheWrite = usage.cache_creation_input_tokens || 0;
              const costUsd = estimateCost(responseModel, inputTokens, outputTokens, cacheRead, cacheWrite);

              // Extract tool calls
              const toolCalls = extractToolCalls(bodyText);

              // Post llm_response event
              const events: Record<string, unknown>[] = [{
                sessionId: "openclaw-main",
                agentId: AGENT_ID,
                eventType: "llm_response",
                severity: "info",
                payload: {
                  callId,
                  provider: "anthropic",
                  model: responseModel,
                  completion: "(streaming)",
                  finishReason,
                  usage: {
                    inputTokens,
                    outputTokens,
                    totalTokens: inputTokens + outputTokens,
                    cacheReadTokens: cacheRead,
                    cacheWriteTokens: cacheWrite,
                  },
                  costUsd,
                  latencyMs: durationMs,
                  toolCallCount: toolCalls.length,
                },
                metadata: { source: "agentlens-relay" },
              }];

              // Post individual tool_call events
              for (const tc of toolCalls) {
                events.push({
                  sessionId: "openclaw-main",
                  agentId: AGENT_ID,
                  eventType: "tool_call",
                  severity: "info",
                  payload: {
                    callId,
                    toolName: tc.toolName,
                    toolCallId: tc.toolCallId,
                  },
                  metadata: { source: "agentlens-relay" },
                });
              }

              debugLog(`RESPONSE: ${responseModel} | ${inputTokens}in/${outputTokens}out | $${costUsd.toFixed(4)} | ${durationMs}ms | ${toolCalls.length} tools`);
              postToAgentLens([events[0]], "llm_response");
              if (events.length > 1) {
                postToAgentLens(events.slice(1), "tool_calls");
              }
            } else {
              debugLog(`NO_USAGE: status=${response.status} bodyLen=${bodyText.length}`);
            }
            } catch (err: any) {
              debugLog(`ERROR reading response: ${err.message}`);
            }
          })();
        }

        return response;
      };

      debugLog("globalThis.fetch wrapped successfully");
      ctx.logger.info("agentlens-relay v4: fetch wrapped ✅");

      postToAgentLens([{
        sessionId: "openclaw-main",
        agentId: AGENT_ID,
        eventType: "custom",
        severity: "info",
        payload: { type: "relay_v4_started", data: { ts: new Date().toISOString() } },
        metadata: { source: "agentlens-relay" },
      }]);
    },

    async stop() {
      if (origFetch) {
        globalThis.fetch = origFetch;
        origFetch = null;
      }
    },
  };
}
