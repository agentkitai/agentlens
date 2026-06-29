/**
 * Drop-in instrumentation (#123): OpenAI + Vercel capture, fail-safe, cost
 * parity, X-Agent-Token propagation.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { costUsdDetailed } from '@agentkitai/pricing';
import { AgentLensClient, init, shutdown } from '../index.js';
import { instrumentOpenAI } from '../openai.js';
import { agentlensMiddleware } from '../vercel.js';

/* eslint-disable @typescript-eslint/no-explicit-any */

afterEach(async () => {
  await shutdown();
});

function recordingClient(opts: { agentToken?: string; fail?: boolean } = {}) {
  const requests: Array<{ url: string; headers: Record<string, string>; body: any }> = [];
  const fetchMock = vi.fn(async (url: any, init: any) => {
    requests.push({ url: String(url), headers: init?.headers ?? {}, body: init?.body ? JSON.parse(init.body) : undefined });
    if (opts.fail) throw new Error('network down');
    return new Response(JSON.stringify({}), { status: 200 });
  });
  const client = new AgentLensClient({ url: 'http://x', apiKey: 'k', agentToken: opts.agentToken, fetch: fetchMock as any, retry: { maxRetries: 0 } });
  return { client, requests };
}

function eventsPost(requests: Array<{ url: string; headers: Record<string, string>; body: any }>) {
  return requests.find((r) => r.url.endsWith('/api/events'));
}

describe('OpenAI instrumentation', () => {
  it('captures a non-streaming call with cost parity + X-Agent-Token, passing the result through', async () => {
    const { client, requests } = recordingClient({ agentToken: 'tok-123' });
    const inst = init({ client, agentId: 'a1', sessionId: 's1' });

    const fakeOpenAI: any = {
      chat: {
        completions: {
          create: async (_p: any) => ({
            model: 'gpt-4o',
            choices: [{ message: { content: 'hi there' }, finish_reason: 'stop' }],
            usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
          }),
        },
      },
    };
    instrumentOpenAI(fakeOpenAI);

    const res = await fakeOpenAI.chat.completions.create({ model: 'gpt-4o', messages: [{ role: 'user', content: 'hey' }] });
    expect(res.choices[0].message.content).toBe('hi there'); // passthrough untouched
    await inst.flush();

    const post = eventsPost(requests)!;
    expect(post.headers['X-Agent-Token']).toBe('tok-123');
    const call = post.body.events.find((e: any) => e.eventType === 'llm_call');
    const resp = post.body.events.find((e: any) => e.eventType === 'llm_response');
    expect(call.payload.model).toBe('gpt-4o');
    expect(call.payload.messages[0]).toEqual({ role: 'user', content: 'hey' });
    expect(resp.payload.usage.inputTokens).toBe(100);
    expect(resp.payload.usage.outputTokens).toBe(50);
    // Cost computed at capture via the pricing package.
    expect(resp.payload.costUsd).toBe(costUsdDetailed('gpt-4o', { inputTokens: 100, outputTokens: 50 }).costUsd);
  });

  it('captures a streaming call, accumulating content + usage without corrupting the stream', async () => {
    const { client, requests } = recordingClient();
    const inst = init({ client, agentId: 'a1', sessionId: 's1' });

    async function* fakeStream() {
      yield { model: 'gpt-4o', choices: [{ delta: { content: 'he' } }] };
      yield { choices: [{ delta: { content: 'llo' }, finish_reason: 'stop' }] };
      yield { choices: [], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } };
    }
    const fakeOpenAI: any = { chat: { completions: { create: async () => fakeStream() } } };
    instrumentOpenAI(fakeOpenAI);

    const stream = await fakeOpenAI.chat.completions.create({ model: 'gpt-4o', messages: [], stream: true });
    let text = '';
    for await (const chunk of stream) text += chunk.choices[0]?.delta?.content ?? '';
    expect(text).toBe('hello'); // stream not corrupted
    await inst.flush();

    const resp = eventsPost(requests)!.body.events.find((e: any) => e.eventType === 'llm_response');
    expect(resp.payload.completion).toBe('hello');
    expect(resp.payload.usage.inputTokens).toBe(10);
    expect(resp.payload.finishReason).toBe('stop');
  });

  it('is fail-safe: a capture/network failure never breaks the user call', async () => {
    const { client } = recordingClient({ fail: true });
    const inst = init({ client, agentId: 'a1', sessionId: 's1' });
    const fakeOpenAI: any = {
      chat: { completions: { create: async () => ({ model: 'gpt-4o', choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }], usage: {} }) } },
    };
    instrumentOpenAI(fakeOpenAI);

    const res = await fakeOpenAI.chat.completions.create({ model: 'gpt-4o', messages: [] });
    expect(res.choices[0].message.content).toBe('ok');
    await expect(inst.flush()).resolves.toBeUndefined(); // swallowed, never throws
  });
});

describe('Vercel AI SDK middleware', () => {
  const fakeModel = { modelId: 'gpt-4o', provider: 'openai.chat' };

  it('wrapGenerate captures with cost + passes the result through', async () => {
    const { client, requests } = recordingClient({ agentToken: 'tok-9' });
    const inst = init({ client, agentId: 'a1', sessionId: 's1' });
    const mw = agentlensMiddleware();

    const result = await mw.wrapGenerate({
      model: fakeModel,
      params: { prompt: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }] },
      doGenerate: async () => ({ text: 'hello', usage: { promptTokens: 20, completionTokens: 8 }, finishReason: 'stop' }),
    });
    expect(result.text).toBe('hello');
    await inst.flush();

    const post = eventsPost(requests)!;
    expect(post.headers['X-Agent-Token']).toBe('tok-9');
    const resp = post.body.events.find((e: any) => e.eventType === 'llm_response');
    expect(resp.payload.completion).toBe('hello');
    expect(resp.payload.usage.inputTokens).toBe(20);
    expect(resp.payload.costUsd).toBe(costUsdDetailed('gpt-4o', { inputTokens: 20, outputTokens: 8 }).costUsd);
  });

  it('wrapStream accumulates parts without corrupting the stream', async () => {
    const { client, requests } = recordingClient();
    const inst = init({ client, agentId: 'a1', sessionId: 's1' });
    const mw = agentlensMiddleware();

    const readableFrom = (parts: any[]) =>
      new ReadableStream({
        start(c) {
          for (const p of parts) c.enqueue(p);
          c.close();
        },
      });

    const out = await mw.wrapStream({
      model: fakeModel,
      params: { prompt: 'hi' },
      doStream: async () => ({
        stream: readableFrom([
          { type: 'text-delta', textDelta: 'he' },
          { type: 'text-delta', textDelta: 'llo' },
          { type: 'finish', usage: { promptTokens: 10, completionTokens: 5 }, finishReason: 'stop' },
        ]),
      }),
    });

    const reader = out.stream.getReader();
    let text = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value.type === 'text-delta') text += value.textDelta;
    }
    expect(text).toBe('hello');
    await inst.flush();

    const resp = eventsPost(requests)!.body.events.find((e: any) => e.eventType === 'llm_response');
    expect(resp.payload.completion).toBe('hello');
    expect(resp.payload.usage.inputTokens).toBe(10);
  });
});
