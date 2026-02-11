/**
 * Delegation REST API (Stories 6.1 + 6.2)
 *
 * POST /api/agents/delegate                          — send a delegation request (outbound)
 * GET  /api/agents/:id/delegations/inbox             — poll for pending requests (inbound)
 * POST /api/agents/:id/delegations/:requestId/accept — accept a delegation
 * POST /api/agents/:id/delegations/:requestId/reject — reject a delegation
 * POST /api/agents/:id/delegations/:requestId/complete — complete with result
 */

import { Hono } from 'hono';
import type { AuthVariables } from '../middleware/auth.js';
import type { SqliteDb } from '../db/index.js';
import { DelegationService, type PoolTransport } from '../services/delegation-service.js';
import { TASK_TYPES } from '@agentlensai/core';

const VALID_TASK_TYPES = new Set<string>(TASK_TYPES);

export function delegationRoutes(db: SqliteDb, transport: PoolTransport) {
  const app = new Hono<{ Variables: AuthVariables }>();
  const service = new DelegationService(db, transport);

  function getTenantId(c: { get(key: 'apiKey'): { tenantId?: string } | undefined }): string {
    return c.get('apiKey')?.tenantId ?? 'default';
  }

  /**
   * @summary Send a delegation request to another agent
   * @description Creates an outbound delegation request targeting another agent by its anonymous ID.
   * The request specifies a task type and input, with optional timeout, fallback, and retry settings.
   * The call blocks until the delegate responds or the timeout expires.
   * @body {{ agentId: string, targetAnonymousId: string, taskType: TaskType, input?: unknown, timeoutMs?: number, fallbackEnabled?: boolean, maxRetries?: number }}
   * @returns {200} `{ result }` — delegation outcome from the target agent
   * @throws {400} Missing or invalid agentId, targetAnonymousId, or taskType
   * @throws {400} Invalid JSON body
   */
  app.post('/delegate', async (c) => {
    const tenantId = getTenantId(c);

    let body: Record<string, unknown>;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: 'Invalid JSON body', status: 400 }, 400);
    }

    const agentId = body.agentId as string;
    if (!agentId) {
      return c.json({ error: 'agentId is required', status: 400 }, 400);
    }

    const targetAnonymousId = body.targetAnonymousId as string;
    if (!targetAnonymousId) {
      return c.json({ error: 'targetAnonymousId is required', status: 400 }, 400);
    }

    const taskType = body.taskType as string;
    if (!taskType || !VALID_TASK_TYPES.has(taskType)) {
      return c.json({ error: 'taskType is required and must be valid', status: 400 }, 400);
    }

    const result = await service.delegate(tenantId, agentId, {
      targetAnonymousId,
      taskType: taskType as any,
      input: body.input,
      timeoutMs: (body.timeoutMs as number) ?? 30000,
      fallbackEnabled: body.fallbackEnabled as boolean | undefined,
      maxRetries: body.maxRetries as number | undefined,
    });

    return c.json({ result });
  });

  /**
   * @summary Poll for pending inbound delegation requests
   * @description Returns all pending delegation requests addressed to the specified agent.
   * @param {string} id — Agent ID (path)
   * @returns {200} `{ requests: DelegationRequest[], total: number }`
   */
  app.get('/:id/delegations/inbox', async (c) => {
    const tenantId = getTenantId(c);
    const agentId = c.req.param('id');

    const inbox = await service.getInbox(tenantId, agentId);
    return c.json({ requests: inbox, total: inbox.length });
  });

  /**
   * @summary Accept a pending delegation request
   * @description Marks the delegation request as accepted by the target agent.
   * @param {string} id — Agent ID (path)
   * @param {string} requestId — Delegation request ID (path)
   * @returns {200} `{ accepted: true }`
   * @throws {400} Request not found, already processed, or agent mismatch
   */
  app.post('/:id/delegations/:requestId/accept', async (c) => {
    const tenantId = getTenantId(c);
    const agentId = c.req.param('id');
    const requestId = c.req.param('requestId');

    const result = await service.acceptDelegation(tenantId, agentId, requestId);
    if (!result.ok) {
      return c.json({ error: result.error, status: 400 }, 400);
    }
    return c.json({ accepted: true });
  });

  /**
   * @summary Reject a pending delegation request
   * @description Marks the delegation request as rejected, with an optional reason.
   * @param {string} id — Agent ID (path)
   * @param {string} requestId — Delegation request ID (path)
   * @body {{ reason?: string }} — optional rejection reason
   * @returns {200} `{ rejected: true }`
   * @throws {400} Request not found, already processed, or agent mismatch
   */
  app.post('/:id/delegations/:requestId/reject', async (c) => {
    const tenantId = getTenantId(c);
    const agentId = c.req.param('id');
    const requestId = c.req.param('requestId');

    let body: Record<string, unknown> = {};
    try {
      body = await c.req.json();
    } catch {
      // Body is optional for reject
    }

    const result = await service.rejectDelegation(tenantId, agentId, requestId, body.reason as string);
    if (!result.ok) {
      return c.json({ error: result.error, status: 400 }, 400);
    }
    return c.json({ rejected: true });
  });

  /**
   * @summary Complete a delegation request with a result
   * @description Marks the delegation as completed and delivers the output back to the requester.
   * @param {string} id — Agent ID (path)
   * @param {string} requestId — Delegation request ID (path)
   * @body {{ output: unknown }} — the delegation result payload
   * @returns {200} `{ completed: true }`
   * @throws {400} Invalid JSON body, request not found, or not in accepted state
   */
  app.post('/:id/delegations/:requestId/complete', async (c) => {
    const tenantId = getTenantId(c);
    const agentId = c.req.param('id');
    const requestId = c.req.param('requestId');

    let body: Record<string, unknown>;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: 'Invalid JSON body', status: 400 }, 400);
    }

    const result = await service.completeDelegation(tenantId, agentId, requestId, body.output);
    if (!result.ok) {
      return c.json({ error: result.error, status: 400 }, 400);
    }
    return c.json({ completed: true });
  });

  return { app, service };
}
