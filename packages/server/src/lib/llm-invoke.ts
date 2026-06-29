/**
 * Server-side LLM invocation over a stored connection (#143).
 *
 * Used to *test* a connection now, and by the Playground / server-side evaluators
 * (#144) later. OpenAI-compatible (openai/azure/custom) + Anthropic. Custom base
 * URLs are SSRF-guarded. The connection's decrypted key never leaves this layer.
 */
import { validateExternalUrl } from './notifications/ssrf.js';

export interface InvokeConnection {
  provider: string;
  apiKey: string;
  baseUrl?: string;
  defaultModel?: string;
}

export interface InvokeMessage {
  role: string;
  content: string;
}

export interface InvokeRequest {
  model?: string;
  messages: InvokeMessage[];
  maxTokens?: number;
  temperature?: number;
}

export interface InvokeResult {
  content: string;
  model: string;
  usage: { inputTokens: number; outputTokens: number };
  finishReason?: string;
}

const DEFAULT_BASE: Record<string, string> = {
  openai: 'https://api.openai.com/v1',
  azure: 'https://api.openai.com/v1',
  custom: 'https://api.openai.com/v1',
  anthropic: 'https://api.anthropic.com/v1',
};

function resolveBase(conn: InvokeConnection): string {
  const base = conn.baseUrl?.trim() || DEFAULT_BASE[conn.provider] || DEFAULT_BASE.openai!;
  if (conn.baseUrl) {
    const check = validateExternalUrl(conn.baseUrl);
    if (!check.valid) throw new Error(`connection base URL rejected: ${check.reason}`);
  }
  return base.replace(/\/+$/, '');
}

async function postJson(url: string, headers: Record<string, string>, body: unknown): Promise<unknown> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`provider returned HTTP ${res.status}: ${text.slice(0, 300)}`);
  try {
    return JSON.parse(text);
  } catch {
    throw new Error('provider returned non-JSON response');
  }
}

/** Invoke a chat completion against the connection's provider. */
export async function invokeLlm(conn: InvokeConnection, req: InvokeRequest): Promise<InvokeResult> {
  const model = req.model || conn.defaultModel;
  if (!model) throw new Error('a model is required (request.model or connection.defaultModel)');
  const base = resolveBase(conn);

  if (conn.provider === 'anthropic') {
    const system = req.messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n') || undefined;
    const messages = req.messages.filter((m) => m.role !== 'system').map((m) => ({ role: m.role, content: m.content }));
    const json = (await postJson(
      `${base}/messages`,
      { 'x-api-key': conn.apiKey, 'anthropic-version': '2023-06-01' },
      { model, max_tokens: req.maxTokens ?? 1024, ...(system ? { system } : {}), messages, ...(req.temperature !== undefined ? { temperature: req.temperature } : {}) },
    )) as any; // eslint-disable-line @typescript-eslint/no-explicit-any
    const content = Array.isArray(json?.content) ? json.content.filter((b: any) => b?.type === 'text').map((b: any) => b.text).join('') : '';
    return {
      content,
      model: String(json?.model ?? model),
      usage: { inputTokens: Number(json?.usage?.input_tokens ?? 0), outputTokens: Number(json?.usage?.output_tokens ?? 0) },
      finishReason: json?.stop_reason ?? undefined,
    };
  }

  // OpenAI-compatible (openai / azure / custom)
  const json = (await postJson(
    `${base}/chat/completions`,
    { Authorization: `Bearer ${conn.apiKey}` },
    { model, messages: req.messages, ...(req.maxTokens ? { max_tokens: req.maxTokens } : {}), ...(req.temperature !== undefined ? { temperature: req.temperature } : {}) },
  )) as any; // eslint-disable-line @typescript-eslint/no-explicit-any
  const choice = json?.choices?.[0];
  return {
    content: typeof choice?.message?.content === 'string' ? choice.message.content : '',
    model: String(json?.model ?? model),
    usage: { inputTokens: Number(json?.usage?.prompt_tokens ?? 0), outputTokens: Number(json?.usage?.completion_tokens ?? 0) },
    finishReason: choice?.finish_reason ?? undefined,
  };
}

/** Cheap liveness check that the credentials work — a 1-token completion. */
export async function testConnection(conn: InvokeConnection): Promise<{ ok: true; model: string } | { ok: false; error: string }> {
  try {
    const r = await invokeLlm(conn, { messages: [{ role: 'user', content: 'ping' }], maxTokens: 1 });
    return { ok: true, model: r.model };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
