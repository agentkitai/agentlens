/**
 * SH-3: Zod Validation Middleware
 *
 * Provides a reusable middleware factory that validates JSON request bodies
 * against a Zod schema and returns 400 with structured error details on failure.
 */

import type { Context, Next } from 'hono';
import type { ZodSchema, ZodError } from 'zod';

/**
 * Format Zod validation errors into a consistent API response shape.
 */
export function formatZodErrors(error: ZodError): { path: string; message: string }[] {
  return error.issues.map((issue) => ({
    path: issue.path.join('.'),
    message: issue.message,
  }));
}

/**
 * Middleware factory: validates `await c.req.json()` against the given Zod schema.
 * On success, stores the parsed data in `c.set('validatedBody', data)`.
 * On failure, returns 400 with `{ error, status, details }`.
 *
 * Usage:
 *   app.post('/foo', validateBody(mySchema), async (c) => {
 *     const body = c.get('validatedBody');
 *     ...
 *   });
 */
export function validateBody<T>(schema: ZodSchema<T>) {
  return async (c: Context, next: Next) => {
    const rawBody = await c.req.json().catch(() => null);
    if (rawBody === null) {
      return c.json({ error: 'Invalid JSON body', status: 400 }, 400);
    }

    const result = schema.safeParse(rawBody);
    if (!result.success) {
      return c.json(
        {
          error: 'Validation failed',
          status: 400,
          details: formatZodErrors(result.error),
        },
        400,
      );
    }

    c.set('validatedBody', result.data);
    return next();
  };
}
