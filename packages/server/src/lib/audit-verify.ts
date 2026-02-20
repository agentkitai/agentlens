/**
 * Audit Trail Verification Engine (Feature 3)
 *
 * Orchestrates batched hash chain verification across sessions,
 * aggregates results into a VerificationReport, and signs with HMAC-SHA256.
 */

import { createHmac } from 'node:crypto';
import { verifyChainBatch } from '@agentlensai/core';
import type { ChainEvent } from '@agentlensai/core';
import type { EventRepository } from '../db/repositories/event-repository.js';
import { createLogger } from './logger.js';

const log = createLogger('AuditVerify');

const BATCH_SIZE = 5000;

// ─── Types ──────────────────────────────────────────────────

export interface BrokenChainDetail {
  sessionId: string;
  failedAtIndex: number;
  failedEventId: string;
  reason: string;
}

export interface VerificationReport {
  verified: boolean;
  verifiedAt: string;
  range: { from: string; to: string } | null;
  sessionId?: string;
  sessionsVerified: number;
  totalEvents: number;
  firstHash: string | null;
  lastHash: string | null;
  brokenChains: BrokenChainDetail[];
  signature: string | null;
}

// ─── Signing ────────────────────────────────────────────────

export function signReport(
  report: Omit<VerificationReport, 'signature'>,
  key: string,
): string {
  const canonical = JSON.stringify(report);
  return 'hmac-sha256:' + createHmac('sha256', key).update(canonical).digest('hex');
}

// ─── Engine ─────────────────────────────────────────────────

export interface VerifyOptions {
  tenantId: string;
  from?: string;
  to?: string;
  sessionId?: string;
  signingKey?: string;
}

interface SessionVerifyResult {
  sessionId: string;
  totalEvents: number;
  firstHash: string | null;
  lastHash: string | null;
  broken?: BrokenChainDetail;
}

function verifySessionChain(
  repo: EventRepository,
  tenantId: string,
  sessionId: string,
): SessionVerifyResult {
  let offset = 0;
  let prevHash: string | null = null;
  let totalEvents = 0;
  let firstHash: string | null = null;
  let lastHash: string | null = null;

  while (true) {
    const batch: ChainEvent[] = repo.getSessionEventsBatch(sessionId, tenantId, offset, BATCH_SIZE);
    if (batch.length === 0) break;

    if (offset === 0 && batch.length > 0) {
      firstHash = batch[0].hash;
    }

    const expectedPrev = offset === 0 ? null : prevHash;
    const result = verifyChainBatch(batch, expectedPrev);

    if (!result.valid) {
      return {
        sessionId,
        totalEvents: totalEvents + batch.length,
        firstHash,
        lastHash: batch[batch.length - 1].hash,
        broken: {
          sessionId,
          failedAtIndex: offset + result.failedAtIndex,
          failedEventId: batch[result.failedAtIndex].id,
          reason: result.reason!,
        },
      };
    }

    totalEvents += batch.length;
    lastHash = batch[batch.length - 1].hash;
    prevHash = lastHash;
    offset += batch.length;

    if (batch.length < BATCH_SIZE) break;
  }

  return { sessionId, totalEvents, firstHash, lastHash };
}

export function runVerification(
  repo: EventRepository,
  options: VerifyOptions,
): VerificationReport {
  const { tenantId, signingKey } = options;

  // Determine which sessions to verify
  let sessionIds: string[];
  if (options.sessionId) {
    sessionIds = [options.sessionId];
  } else {
    sessionIds = repo.getSessionIdsInRange(tenantId, options.from!, options.to!);
  }

  const brokenChains: BrokenChainDetail[] = [];
  let totalEvents = 0;
  let globalFirstHash: string | null = null;
  let globalLastHash: string | null = null;

  for (const sid of sessionIds) {
    const result = verifySessionChain(repo, tenantId, sid);
    totalEvents += result.totalEvents;

    if (globalFirstHash === null && result.firstHash !== null) {
      globalFirstHash = result.firstHash;
    }
    if (result.lastHash !== null) {
      globalLastHash = result.lastHash;
    }

    if (result.broken) {
      brokenChains.push(result.broken);
    }
  }

  const reportBody: Omit<VerificationReport, 'signature'> = {
    verified: brokenChains.length === 0,
    verifiedAt: new Date().toISOString(),
    range: options.sessionId ? null : { from: options.from!, to: options.to! },
    ...(options.sessionId ? { sessionId: options.sessionId } : {}),
    sessionsVerified: sessionIds.length,
    totalEvents,
    firstHash: globalFirstHash,
    lastHash: globalLastHash,
    brokenChains,
  };

  let signature: string | null = null;
  if (signingKey) {
    signature = signReport(reportBody, signingKey);
  } else {
    log.warn('No audit signing key configured — report will be unsigned');
  }

  return { ...reportBody, signature };
}
