/**
 * Common OpenAPI schemas shared across all route files.
 * [F13-S1] Foundation schemas for error responses, pagination, and auth.
 *
 * Uses zod/v3 compat layer for @hono/zod-openapi compatibility with Zod v4.
 */
import { z } from '@hono/zod-openapi';

// ─── Reusable Error Response ────────────────────────────
export const ErrorResponseSchema = z.object({
  error: z.string().openapi({ example: 'Not found' }),
  status: z.number().int().openapi({ example: 404 }),
  details: z.array(z.object({
    path: z.string(),
    message: z.string(),
  })).optional(),
}).openapi('ErrorResponse');

// ─── Pagination Query Params ────────────────────────────
export const PaginationQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(500).default(50)
    .openapi({ example: 50, description: 'Maximum number of items to return' }),
  offset: z.coerce.number().int().min(0).default(0)
    .openapi({ example: 0, description: 'Number of items to skip' }),
});

// ─── Paginated Response Wrapper ─────────────────────────
export function paginatedResponse<T extends z.ZodType>(itemSchema: T, name: string) {
  return z.object({
    [name]: z.array(itemSchema),
    total: z.number().int(),
    hasMore: z.boolean(),
  });
}

// ─── Auth Security Scheme ───────────────────────────────
export const BearerAuthScheme = {
  type: 'http' as const,
  scheme: 'bearer',
  bearerFormat: 'API Key (als_xxx)',
  description: 'AgentLens API key. Obtain via /api/keys or the dashboard.',
};

// ─── Common path param schemas ──────────────────────────
export const IdParamSchema = z.object({
  id: z.string().openapi({ example: 'agent_01HXK', description: 'Resource identifier' }),
});
