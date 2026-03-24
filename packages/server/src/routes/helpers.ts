/**
 * Shared CRUD route helpers for Hono route handlers.
 *
 * Reduces boilerplate for body parsing/validation, 404 responses, and 201 responses.
 */

import type { Context } from 'hono';
import type { ZodSchema, ZodError } from 'zod';

/**
 * Parse and validate a JSON request body against a Zod schema.
 * Returns `{ success: true, data }` on success, or sends a 400 response and returns `{ success: false }`.
 */
export async function parseBody<T>(
  c: Context,
  schema: ZodSchema<T>,
): Promise<{ success: true; data: T } | { success: false; response: Response }> {
  const rawBody = await c.req.json().catch(() => null);
  if (!rawBody) {
    return {
      success: false,
      response: c.json({ error: 'Invalid JSON body', status: 400 }, 400),
    };
  }

  const result = schema.safeParse(rawBody);
  if (!result.success) {
    return {
      success: false,
      response: c.json(
        {
          error: 'Validation failed',
          status: 400,
          details: (result.error as ZodError).issues.map((issue) => ({
            path: issue.path.map(String).join('.'),
            message: issue.message,
          })),
        },
        400,
      ),
    };
  }

  return { success: true, data: result.data };
}

/**
 * Return a standard 404 JSON response.
 */
export function notFound(c: Context, entity: string): Response {
  return c.json({ error: `${entity} not found`, status: 404 }, 404);
}

/**
 * Return a standard 201 JSON response with the created resource.
 */
export function created(c: Context, data: unknown): Response {
  return c.json(data, 201);
}
