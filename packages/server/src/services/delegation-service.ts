/**
 * Delegation Service (Stories 6.1 + 6.2 — Delegation Core & Inbox)
 *
 * Implements the 4-phase delegation protocol: REQUEST → ACCEPT → EXECUTE → RETURN
 * Uses a PoolTransport interface for communication (LocalPoolTransport for testing).
 */

import { randomUUID } from 'node:crypto';
import { eq, and } from 'drizzle-orm';
import type { SqliteDb } from '../db/index.js';
import { delegationLog, capabilityRegistry } from '../db/schema.sqlite.js';
import { AnonymousIdManager } from '../db/anonymous-id-manager.js';
import { DiscoveryService, RateLimiter } from './discovery-service.js';
import { TrustService } from './trust-service.js';
import { createLogger } from '../lib/logger.js';
import type { DelegationRequest, DelegationResult, DelegationPhase, TaskType } from '@agentlensai/core';

// ─── Pool Transport Interface ─────────────────────────────

export interface PoolDelegationRequest {
  requestId: string;
  requesterAnonymousId: string;
  targetAnonymousId: string;
  taskType: TaskType;
  input: unknown;
  timeoutMs: number;
  status: DelegationPhase;
  output?: unknown;
  createdAt: string;
  completedAt?: string;
}

export interface PoolTransport {
  /** Send a new delegation request to the pool */
  sendDelegationRequest(request: PoolDelegationRequest): Promise<void>;

  /** Poll for pending delegation requests targeting a specific anonymous agent */
  pollDelegationInbox(targetAnonymousId: string): Promise<PoolDelegationRequest[]>;

  /** Update the status of a delegation request in the pool */
  updateDelegationStatus(
    requestId: string,
    status: DelegationPhase,
    output?: unknown,
  ): Promise<PoolDelegationRequest | null>;

  /** Get a delegation request by ID */
  getDelegationRequest(requestId: string): Promise<PoolDelegationRequest | null>;
}

// ─── Local Pool Transport (in-memory, for testing) ────────

export class LocalPoolTransport implements PoolTransport {
  private requests = new Map<string, PoolDelegationRequest>();

  async sendDelegationRequest(request: PoolDelegationRequest): Promise<void> {
    this.requests.set(request.requestId, { ...request });
  }

  async pollDelegationInbox(targetAnonymousId: string): Promise<PoolDelegationRequest[]> {
    const results: PoolDelegationRequest[] = [];
    for (const req of this.requests.values()) {
      if (req.targetAnonymousId === targetAnonymousId && req.status === 'request') {
        results.push({ ...req });
      }
    }
    return results;
  }

  async updateDelegationStatus(
    requestId: string,
    status: DelegationPhase,
    output?: unknown,
  ): Promise<PoolDelegationRequest | null> {
    const req = this.requests.get(requestId);
    if (!req) return null;
    req.status = status;
    if (output !== undefined) req.output = output;
    if (status === 'completed' || status === 'rejected' || status === 'timeout' || status === 'error') {
      req.completedAt = new Date().toISOString();
    }
    return { ...req };
  }

  async getDelegationRequest(requestId: string): Promise<PoolDelegationRequest | null> {
    const req = this.requests.get(requestId);
    return req ? { ...req } : null;
  }

  /** Reset for testing */
  clear(): void {
    this.requests.clear();
  }

  /** Get all requests (for testing inspection) */
  getAll(): PoolDelegationRequest[] {
    return Array.from(this.requests.values());
  }
}

// ─── Delegation Service Options ───────────────────────────

export interface DelegationServiceOptions {
  /** Default timeout for delegation requests (ms). Default: 30000 */
  defaultTimeoutMs?: number;
  /** Accept timeout — auto-reject if not accepted within this time (ms). Default: 5000 */
  acceptTimeoutMs?: number;
  /** Override for current time (useful for testing) */
  now?: () => Date;
}

// ─── Delegation Service ───────────────────────────────────

export class DelegationService {
  private readonly anonIdManager: AnonymousIdManager;
  private readonly discoveryService: DiscoveryService;
  private readonly trustService: TrustService;
  private static readonly delegationLog = createLogger('DelegationService');
  private readonly defaultTimeoutMs: number;
  private readonly acceptTimeoutMs: number;
  private readonly now: () => Date;
  readonly inboundLimiter = new RateLimiter();

  constructor(
    private readonly db: SqliteDb,
    private readonly transport: PoolTransport,
    options?: DelegationServiceOptions,
  ) {
    this.anonIdManager = new AnonymousIdManager(db);
    this.discoveryService = new DiscoveryService(db);
    this.trustService = new TrustService(db);
    this.defaultTimeoutMs = options?.defaultTimeoutMs ?? 30_000;
    this.acceptTimeoutMs = options?.acceptTimeoutMs ?? 5_000;
    this.now = options?.now ?? (() => new Date());
  }

  // ─── Outbound: delegate() ─────────────────────────────

  /**
   * Send a delegation request to a target agent (outbound).
   * Implements the 4-phase protocol: REQUEST → ACCEPT → EXECUTE → RETURN
   * Supports fallback: on failure/timeout, retries with next-ranked discovery result.
   */
  async delegate(
    tenantId: string,
    agentId: string,
    request: Omit<DelegationRequest, 'requestId'> & { requestId?: string },
  ): Promise<DelegationResult> {
    const fallbackEnabled = request.fallbackEnabled ?? false;
    const maxRetries = Math.min(request.maxRetries ?? 3, 10);

    // Build list of targets to try: primary target first, then fallback candidates
    const targets: string[] = [request.targetAnonymousId];

    if (fallbackEnabled && maxRetries > 0) {
      // Discover alternative targets for fallback
      const alternatives = this.discoveryService.discover(tenantId, {
        taskType: request.taskType,
        scope: 'internal',
        limit: maxRetries + 5,
      });
      for (const alt of alternatives) {
        if (alt.anonymousAgentId !== request.targetAnonymousId && !targets.includes(alt.anonymousAgentId)) {
          targets.push(alt.anonymousAgentId);
        }
        if (targets.length >= maxRetries + 1) break; // +1 for original
      }
    }

    let retriesUsed = 0;
    let lastResult: DelegationResult | undefined;

    for (let attempt = 0; attempt < targets.length; attempt++) {
      const targetAnonId = targets[attempt];
      const result = await this.delegateSingle(tenantId, agentId, {
        ...request,
        targetAnonymousId: targetAnonId,
        requestId: attempt === 0 ? request.requestId : undefined,
      });

      // Update trust after each delegation outcome
      this.updateTrustAfterDelegation(tenantId, agentId);

      lastResult = result;

      if (result.status === 'success') {
        return { ...result, retriesUsed };
      }

      // If fallback not enabled or this was the last attempt, return
      if (!fallbackEnabled || attempt >= targets.length - 1) {
        return { ...result, retriesUsed };
      }

      retriesUsed++;
    }

    return { ...lastResult!, retriesUsed };
  }

  /**
   * Execute a single delegation attempt (no fallback).
   */
  private async delegateSingle(
    tenantId: string,
    agentId: string,
    request: Omit<DelegationRequest, 'requestId'> & { requestId?: string },
  ): Promise<DelegationResult> {
    const requestId = request.requestId ?? randomUUID();
    const timeoutMs = request.timeoutMs ?? this.defaultTimeoutMs;
    const startTime = this.now().getTime();

    // 1. Check delegation is enabled at tenant level
    const config = this.discoveryService.getDiscoveryConfig(tenantId);
    if (!config.delegationEnabled) {
      return {
        requestId,
        status: 'rejected',
        output: 'Delegation is disabled for this tenant',
      };
    }

    // 2. Check outbound rate limit
    const agentCaps = this.getAgentCapabilities(tenantId, agentId);
    const outboundLimit = agentCaps?.outboundRateLimit ?? 20;
    if (!this.discoveryService.checkOutboundRateLimit(agentId, outboundLimit)) {
      this.logDelegation(tenantId, {
        id: requestId,
        direction: 'outbound',
        agentId,
        anonymousTargetId: request.targetAnonymousId,
        taskType: request.taskType,
        status: 'error',
        createdAt: this.now().toISOString(),
        completedAt: this.now().toISOString(),
      });
      return {
        requestId,
        status: 'error',
        output: 'Outbound rate limit exceeded',
      };
    }

    // 3. Check trust threshold (H5 FIX: now actually computes trust)
    const trustOk = this.checkTrustThreshold(tenantId, request.targetAnonymousId, agentId);
    if (!trustOk) {
      this.logDelegation(tenantId, {
        id: requestId,
        direction: 'outbound',
        agentId,
        anonymousTargetId: request.targetAnonymousId,
        taskType: request.taskType,
        status: 'rejected',
        createdAt: this.now().toISOString(),
        completedAt: this.now().toISOString(),
      });
      return {
        requestId,
        status: 'rejected',
        output: 'Target does not meet minimum trust threshold',
      };
    }

    // 4. Get anonymous ID for the requesting agent
    const requesterAnonId = this.anonIdManager.getOrRotateAnonymousId(tenantId, agentId);

    // Redaction removed — delegated to Lore service.
    // Delegation proceeds without input redaction (fail-open).
    const redactedInput = request.input;

    // 5. Send request to pool transport
    const poolRequest: PoolDelegationRequest = {
      requestId,
      requesterAnonymousId: requesterAnonId,
      targetAnonymousId: request.targetAnonymousId,
      taskType: request.taskType,
      input: redactedInput,
      timeoutMs,
      status: 'request',
      createdAt: this.now().toISOString(),
    };

    await this.transport.sendDelegationRequest(poolRequest);

    // Log the outbound delegation
    this.logDelegation(tenantId, {
      id: requestId,
      direction: 'outbound',
      agentId,
      anonymousTargetId: request.targetAnonymousId,
      taskType: request.taskType,
      status: 'request',
      requestSizeBytes: JSON.stringify(request.input).length,
      createdAt: this.now().toISOString(),
    });

    // 6. Wait for result (poll-based with timeout)
    const result = await this.waitForResult(requestId, timeoutMs, startTime);

    // 7. Update delegation log
    const executionTimeMs = this.now().getTime() - startTime;
    this.updateDelegationLog(tenantId, requestId, {
      status: result.status === 'success' ? 'completed' : result.status,
      executionTimeMs,
      responseSizeBytes: result.output ? JSON.stringify(result.output).length : undefined,
      completedAt: this.now().toISOString(),
    });

    return {
      ...result,
      requestId,
      executionTimeMs,
    };
  }

  /**
   * Update trust score after a delegation outcome.
   */
  private updateTrustAfterDelegation(tenantId: string, agentId: string): void {
    try {
      this.trustService.updateAfterDelegation(tenantId, agentId);
    } catch {
      // Trust updates should not break delegation
    }
  }

  // ─── Inbound: inbox & acceptance ──────────────────────

  /**
   * Poll the inbox for pending delegation requests targeting this agent.
   */
  async getInbox(tenantId: string, agentId: string): Promise<PoolDelegationRequest[]> {
    const anonId = this.anonIdManager.getOrRotateAnonymousId(tenantId, agentId);
    const pending = await this.transport.pollDelegationInbox(anonId);

    // Filter out expired requests (accept timeout)
    const now = this.now().getTime();
    const valid: PoolDelegationRequest[] = [];
    for (const req of pending) {
      const createdAt = new Date(req.createdAt).getTime();
      if (now - createdAt > this.acceptTimeoutMs) {
        // Auto-reject expired requests
        await this.transport.updateDelegationStatus(req.requestId, 'timeout');
      } else {
        valid.push(req);
      }
    }
    return valid;
  }

  /**
   * Accept a delegation request.
   */
  async acceptDelegation(
    tenantId: string,
    agentId: string,
    requestId: string,
  ): Promise<{ ok: boolean; error?: string }> {
    // Check acceptDelegations toggle
    const caps = this.getAgentCapabilities(tenantId, agentId);
    if (!caps?.acceptDelegations) {
      // Reject — acceptDelegations is disabled
      await this.transport.updateDelegationStatus(requestId, 'rejected');
      return { ok: false, error: 'Agent does not accept delegations' };
    }

    // Check inbound rate limit
    const inboundLimit = caps.inboundRateLimit ?? 10;
    if (!this.inboundLimiter.check(`inbound:${agentId}`, inboundLimit)) {
      await this.transport.updateDelegationStatus(requestId, 'rejected');
      return { ok: false, error: 'Inbound rate limit exceeded' };
    }

    // Check the request exists and is in 'request' status
    const req = await this.transport.getDelegationRequest(requestId);
    if (!req) {
      return { ok: false, error: 'Delegation request not found' };
    }

    // Check accept timeout
    const createdAt = new Date(req.createdAt).getTime();
    const now = this.now().getTime();
    if (now - createdAt > this.acceptTimeoutMs) {
      await this.transport.updateDelegationStatus(requestId, 'timeout');
      return { ok: false, error: 'Accept timeout exceeded' };
    }

    if (req.status !== 'request') {
      return { ok: false, error: `Cannot accept delegation in status: ${req.status}` };
    }

    // Verify the target matches this agent's anonymous ID
    const anonId = this.anonIdManager.getOrRotateAnonymousId(tenantId, agentId);
    if (req.targetAnonymousId !== anonId) {
      return { ok: false, error: 'Delegation request is not targeted at this agent' };
    }

    await this.transport.updateDelegationStatus(requestId, 'accepted');

    // Log inbound delegation
    this.logDelegation(tenantId, {
      id: requestId,
      direction: 'inbound',
      agentId,
      anonymousSourceId: req.requesterAnonymousId,
      taskType: req.taskType,
      status: 'accepted',
      requestSizeBytes: JSON.stringify(req.input).length,
      createdAt: req.createdAt,
    });

    return { ok: true };
  }

  /**
   * Reject a delegation request.
   */
  async rejectDelegation(
    tenantId: string,
    agentId: string,
    requestId: string,
    reason?: string,
  ): Promise<{ ok: boolean; error?: string }> {
    const req = await this.transport.getDelegationRequest(requestId);
    if (!req) {
      return { ok: false, error: 'Delegation request not found' };
    }

    if (req.status !== 'request' && req.status !== 'accepted') {
      return { ok: false, error: `Cannot reject delegation in status: ${req.status}` };
    }

    // Verify the target matches this agent
    const anonId = this.anonIdManager.getOrRotateAnonymousId(tenantId, agentId);
    if (req.targetAnonymousId !== anonId) {
      return { ok: false, error: 'Delegation request is not targeted at this agent' };
    }

    await this.transport.updateDelegationStatus(requestId, 'rejected');

    // Log
    this.logDelegation(tenantId, {
      id: requestId,
      direction: 'inbound',
      agentId,
      anonymousSourceId: req.requesterAnonymousId,
      taskType: req.taskType,
      status: 'rejected',
      createdAt: req.createdAt,
      completedAt: this.now().toISOString(),
    });

    return { ok: true };
  }

  /**
   * Complete a delegation request with a result.
   */
  async completeDelegation(
    tenantId: string,
    agentId: string,
    requestId: string,
    output: unknown,
  ): Promise<{ ok: boolean; error?: string }> {
    const req = await this.transport.getDelegationRequest(requestId);
    if (!req) {
      return { ok: false, error: 'Delegation request not found' };
    }

    if (req.status !== 'accepted' && req.status !== 'executing') {
      return { ok: false, error: `Cannot complete delegation in status: ${req.status}` };
    }

    // Verify the target matches this agent
    const anonId = this.anonIdManager.getOrRotateAnonymousId(tenantId, agentId);
    if (req.targetAnonymousId !== anonId) {
      return { ok: false, error: 'Delegation request is not targeted at this agent' };
    }

    await this.transport.updateDelegationStatus(requestId, 'completed', output);

    // Update log
    const completedAt = this.now().toISOString();
    this.updateDelegationLog(tenantId, requestId, {
      status: 'completed',
      responseSizeBytes: JSON.stringify(output).length,
      completedAt,
    });

    return { ok: true };
  }

  // ─── Helpers ──────────────────────────────────────────

  private getAgentCapabilities(tenantId: string, agentId: string): {
    outboundRateLimit: number;
    inboundRateLimit: number;
    acceptDelegations: boolean;
  } | null {
    // Query capability_registry for the agent's permission settings
    const rows = this.db
      .select()
      .from(capabilityRegistry)
      .where(
        and(
          eq(capabilityRegistry.tenantId, tenantId),
          eq(capabilityRegistry.agentId, agentId),
        ),
      )
      .all();

    if (rows.length === 0) return null;

    // Use the first capability's settings (all caps for an agent share settings)
    const row = rows[0];
    return {
      outboundRateLimit: row.outboundRateLimit,
      inboundRateLimit: row.inboundRateLimit,
      acceptDelegations: row.acceptDelegations,
    };
  }

  /**
   * H5 FIX: Actually check trust threshold using the TrustService.
   * Computes the requesting agent's trust score on-the-fly and compares
   * against the tenant's minimum trust threshold.
   */
  private checkTrustThreshold(tenantId: string, _targetAnonymousId: string, agentId?: string): boolean {
    if (!agentId) return true; // Can't check without agentId
    try {
      const config = this.discoveryService.getDiscoveryConfig(tenantId);
      const trustScore = this.trustService.getTrustScore(tenantId, agentId);
      return trustScore.percentile >= config.minTrustThreshold;
    } catch {
      // If trust computation fails, fail-open to avoid breaking delegation
      return true;
    }
  }

  private async waitForResult(
    requestId: string,
    timeoutMs: number,
    startTime: number,
  ): Promise<DelegationResult> {
    // Poll for result with small intervals
    const pollInterval = 50; // ms
    while (true) {
      const elapsed = this.now().getTime() - startTime;
      if (elapsed >= timeoutMs) {
        await this.transport.updateDelegationStatus(requestId, 'timeout');
        return { requestId, status: 'timeout' };
      }

      const req = await this.transport.getDelegationRequest(requestId);
      if (!req) {
        return { requestId, status: 'error', output: 'Request not found' };
      }

      if (req.status === 'completed') {
        return { requestId, status: 'success', output: req.output };
      }
      if (req.status === 'rejected') {
        return { requestId, status: 'rejected' };
      }
      if (req.status === 'timeout') {
        return { requestId, status: 'timeout' };
      }
      if (req.status === 'error') {
        return { requestId, status: 'error', output: req.output };
      }

      // Wait before next poll
      await new Promise((resolve) => setTimeout(resolve, pollInterval));
    }
  }

  private logDelegation(
    tenantId: string,
    data: {
      id: string;
      direction: string;
      agentId: string;
      anonymousTargetId?: string;
      anonymousSourceId?: string;
      taskType: string;
      status: string;
      requestSizeBytes?: number;
      responseSizeBytes?: number;
      executionTimeMs?: number;
      costUsd?: number;
      createdAt: string;
      completedAt?: string;
    },
  ): void {
    try {
      // Check if entry already exists (upsert logic)
      const existing = this.db
        .select()
        .from(delegationLog)
        .where(eq(delegationLog.id, data.id))
        .get();

      if (existing) {
        // Update existing
        this.updateDelegationLog(tenantId, data.id, {
          status: data.status,
          responseSizeBytes: data.responseSizeBytes,
          executionTimeMs: data.executionTimeMs,
          completedAt: data.completedAt,
        });
        return;
      }

      this.db.insert(delegationLog).values({
        id: data.id,
        tenantId,
        direction: data.direction,
        agentId: data.agentId,
        anonymousTargetId: data.anonymousTargetId ?? null,
        anonymousSourceId: data.anonymousSourceId ?? null,
        taskType: data.taskType,
        status: data.status,
        requestSizeBytes: data.requestSizeBytes ?? null,
        responseSizeBytes: data.responseSizeBytes ?? null,
        executionTimeMs: data.executionTimeMs ?? null,
        costUsd: data.costUsd ?? null,
        createdAt: data.createdAt,
        completedAt: data.completedAt ?? null,
      }).run();
    } catch {
      // Log failures should not break delegation
    }
  }

  private updateDelegationLog(
    tenantId: string,
    requestId: string,
    updates: {
      status?: string;
      responseSizeBytes?: number;
      executionTimeMs?: number;
      completedAt?: string;
    },
  ): void {
    try {
      const setObj: Record<string, unknown> = {};
      if (updates.status !== undefined) setObj.status = updates.status;
      if (updates.responseSizeBytes !== undefined) setObj.responseSizeBytes = updates.responseSizeBytes;
      if (updates.executionTimeMs !== undefined) setObj.executionTimeMs = updates.executionTimeMs;
      if (updates.completedAt !== undefined) setObj.completedAt = updates.completedAt;

      if (Object.keys(setObj).length > 0) {
        this.db
          .update(delegationLog)
          .set(setObj)
          .where(and(eq(delegationLog.id, requestId), eq(delegationLog.tenantId, tenantId)))
          .run();
      }
    } catch {
      // Log failures should not break delegation
    }
  }

  /**
   * Get delegation logs for a tenant (for auditing/dashboard).
   */
  getDelegationLogs(tenantId: string, agentId?: string): Array<typeof delegationLog.$inferSelect> {
    if (agentId) {
      return this.db
        .select()
        .from(delegationLog)
        .where(and(eq(delegationLog.tenantId, tenantId), eq(delegationLog.agentId, agentId)))
        .all();
    }
    return this.db
      .select()
      .from(delegationLog)
      .where(eq(delegationLog.tenantId, tenantId))
      .all();
  }

  // ─── Story 6.5: Delegation Audit & Logging ────────────

  /**
   * Get delegations for a specific agent with filters.
   */
  getDelegationsForAgent(
    tenantId: string,
    agentId: string,
    filters?: {
      direction?: 'inbound' | 'outbound';
      status?: string;
      dateFrom?: string;
      dateTo?: string;
    },
  ): Array<typeof delegationLog.$inferSelect> {
    let rows = this.db
      .select()
      .from(delegationLog)
      .where(and(eq(delegationLog.tenantId, tenantId), eq(delegationLog.agentId, agentId)))
      .all();

    if (filters?.direction) {
      rows = rows.filter((r) => r.direction === filters.direction);
    }
    if (filters?.status) {
      rows = rows.filter((r) => r.status === filters.status);
    }
    if (filters?.dateFrom) {
      rows = rows.filter((r) => r.createdAt >= filters.dateFrom!);
    }
    if (filters?.dateTo) {
      rows = rows.filter((r) => r.createdAt <= filters.dateTo!);
    }

    return rows;
  }

  /**
   * Export delegation logs as JSON for a tenant.
   */
  exportDelegationLogs(tenantId: string): string {
    const logs = this.getDelegationLogs(tenantId);
    return JSON.stringify(logs, null, 2);
  }

  /**
   * Cleanup delegation logs older than retention period.
   * Default: 90 days. Configurable via retentionDays parameter.
   */
  cleanupOldLogs(tenantId: string, retentionDays: number = 90): number {
    const cutoff = new Date(this.now().getTime() - retentionDays * 24 * 60 * 60 * 1000);
    const cutoffIso = cutoff.toISOString();

    // Get count before delete
    const oldLogs = this.db
      .select()
      .from(delegationLog)
      .where(eq(delegationLog.tenantId, tenantId))
      .all()
      .filter((r) => r.createdAt < cutoffIso);

    for (const log of oldLogs) {
      this.db
        .delete(delegationLog)
        .where(and(eq(delegationLog.id, log.id), eq(delegationLog.tenantId, tenantId)))
        .run();
    }

    return oldLogs.length;
  }

  /**
   * Detect volume alerts: >100 delegations/hour triggers alert flag.
   * Returns true if alert should fire.
   */
  checkVolumeAlert(tenantId: string, threshold: number = 100): { alert: boolean; count: number } {
    const oneHourAgo = new Date(this.now().getTime() - 60 * 60 * 1000).toISOString();
    const recentLogs = this.db
      .select()
      .from(delegationLog)
      .where(eq(delegationLog.tenantId, tenantId))
      .all()
      .filter((r) => r.createdAt >= oneHourAgo);

    return {
      alert: recentLogs.length > threshold,
      count: recentLogs.length,
    };
  }
}
