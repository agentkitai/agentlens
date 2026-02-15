/**
 * SH-3: Validation middleware + body limit tests
 */
import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import { z } from 'zod';
import { validateBody, formatZodErrors } from '../validation.js';
import { bodyLimit } from 'hono/body-limit';

const testSchema = z.object({
  name: z.string().min(1),
  count: z.number().int().min(0).optional(),
});

function createTestApp() {
  const app = new Hono();

  // Apply body limit (small for testing — 256 bytes)
  app.use('/api/*', bodyLimit({
    maxSize: 256,
    onError: (c) => c.json({ error: 'Request body too large', status: 413 }, 413),
  }));

  // Route with validation middleware
  app.post('/api/test', validateBody(testSchema), async (c) => {
    const body = c.get('validatedBody') as z.infer<typeof testSchema>;
    return c.json({ ok: true, name: body.name, count: body.count });
  });

  // Route without validation (for body limit testing)
  app.post('/api/echo', async (c) => {
    const body = await c.req.json();
    return c.json(body);
  });

  return app;
}

describe('validateBody middleware', () => {
  const app = createTestApp();

  it('passes valid input through', async () => {
    const res = await app.request('/api/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'hello', count: 5 }),
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual({ ok: true, name: 'hello', count: 5 });
  });

  it('passes valid input with optional fields omitted', async () => {
    const res = await app.request('/api/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'world' }),
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.name).toBe('world');
  });

  it('returns 400 for invalid input with error details', async () => {
    const res = await app.request('/api/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: '', count: -1 }),
    });
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe('Validation failed');
    expect(json.status).toBe(400);
    expect(json.details).toBeInstanceOf(Array);
    expect(json.details.length).toBeGreaterThan(0);
    expect(json.details[0]).toHaveProperty('path');
    expect(json.details[0]).toHaveProperty('message');
  });

  it('returns 400 for missing required fields', async () => {
    const res = await app.request('/api/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ count: 5 }),
    });
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe('Validation failed');
    expect(json.details.some((d: any) => d.path === 'name')).toBe(true);
  });

  it('returns 400 for wrong types', async () => {
    const res = await app.request('/api/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 123 }),
    });
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe('Validation failed');
  });

  it('returns 400 for invalid JSON', async () => {
    const res = await app.request('/api/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not json at all',
    });
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe('Invalid JSON body');
  });

  it('strips unknown fields (Zod default behavior)', async () => {
    const res = await app.request('/api/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'test', unknown: 'field', count: 1 }),
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
  });
});

describe('body limit middleware', () => {
  const app = createTestApp();

  it('allows small requests', async () => {
    const res = await app.request('/api/echo', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ small: true }),
    });
    expect(res.status).toBe(200);
  });

  it('rejects oversized requests with 413', async () => {
    const bigPayload = JSON.stringify({ data: 'x'.repeat(300) });
    const res = await app.request('/api/echo', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: bigPayload,
    });
    expect(res.status).toBe(413);
    const json = await res.json();
    expect(json.error).toBe('Request body too large');
  });
});

describe('formatZodErrors', () => {
  it('formats nested paths correctly', () => {
    const schema = z.object({
      nested: z.object({
        value: z.number(),
      }),
    });
    const result = schema.safeParse({ nested: { value: 'not a number' } });
    expect(result.success).toBe(false);
    if (!result.success) {
      const errors = formatZodErrors(result.error);
      expect(errors[0].path).toBe('nested.value');
      expect(errors[0].message).toBeTruthy();
    }
  });
});
