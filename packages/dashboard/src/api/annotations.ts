/**
 * Annotation queues & human-scoring review (#146).
 * Thin client over the existing /api/annotations backend (#122) — no new score API.
 */
import { request, toQueryString } from './core';
import type { HumanScoreRequest } from '@agentkitai/agentlens-core';

export type { HumanScoreRequest };

export type AnnotationItemStatus = 'pending' | 'in_review' | 'scored' | 'skipped';

export interface AnnotationQueue {
  id: string;
  tenantId: string;
  name: string;
  description?: string;
  /** Free-form config; may carry `evaluatorId` and/or `dimensions` for the score form. */
  config: Record<string, unknown>;
  createdBy?: string;
  createdAt: string;
  updatedAt: string;
}

export interface AnnotationItem {
  id: string;
  queueId: string;
  tenantId: string;
  sessionId: string;
  traceId?: string;
  status: AnnotationItemStatus;
  assignee?: string;
  dueAt?: string;
  scoreEventId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface SubmitScoreResult {
  item: AnnotationItem;
  event: { id: string; hash: string; prevHash: string | null };
}

export function listQueues(): Promise<{ queues: AnnotationQueue[] }> {
  return request('/api/annotations/queues');
}

export function getQueue(id: string): Promise<{ queue: AnnotationQueue; items: AnnotationItem[] }> {
  return request(`/api/annotations/queues/${encodeURIComponent(id)}`);
}

export function listItems(
  queueId: string,
  filters: { status?: AnnotationItemStatus; assignee?: string } = {},
): Promise<{ items: AnnotationItem[] }> {
  return request(`/api/annotations/queues/${encodeURIComponent(queueId)}/items${toQueryString(filters)}`);
}

export function createQueue(input: {
  name: string;
  description?: string;
  config?: Record<string, unknown>;
}): Promise<{ queue: AnnotationQueue }> {
  return request('/api/annotations/queues', { method: 'POST', body: JSON.stringify(input) });
}

export function addItems(
  queueId: string,
  items: Array<{ sessionId: string; traceId?: string; dueAt?: string }>,
): Promise<{ items: AnnotationItem[] }> {
  return request(`/api/annotations/queues/${encodeURIComponent(queueId)}/items`, {
    method: 'POST',
    body: JSON.stringify({ items }),
  });
}

export function claimItem(id: string): Promise<{ item: AnnotationItem }> {
  return request(`/api/annotations/items/${encodeURIComponent(id)}/claim`, { method: 'POST' });
}

/** Submit exactly one human_score for the item (server stamps annotator identity). */
export function submitScore(id: string, body: HumanScoreRequest): Promise<SubmitScoreResult> {
  return request(`/api/annotations/items/${encodeURIComponent(id)}/submit`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export function skipItem(id: string): Promise<{ item: AnnotationItem }> {
  return request(`/api/annotations/items/${encodeURIComponent(id)}/skip`, { method: 'POST' });
}
