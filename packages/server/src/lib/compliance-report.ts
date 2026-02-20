/**
 * Compliance Report Builder (Feature 9 — EU AI Act)
 *
 * Orchestrates data queries to assemble a complete compliance report.
 * Signs the assembled report with HMAC-SHA256.
 */

import { createHmac } from 'node:crypto';
import { HASH_VERSION } from '@agentlensai/core';
import type { EventRepository } from '../db/repositories/event-repository.js';
import type { AnalyticsRepository } from '../db/repositories/analytics-repository.js';
import type { GuardrailStore } from '../db/guardrail-store.js';
import { runVerification, type VerificationReport } from './audit-verify.js';

// ─── Types ──────────────────────────────────────────────────

export const COMPLIANCE_REPORT_VERSION = 1;

export interface IncidentEntry {
  eventId: string;
  timestamp: string;
  sessionId: string;
  agentId: string;
  eventType: string;
  severity: string;
  summary: string;
}

export interface ComplianceReport {
  version: typeof COMPLIANCE_REPORT_VERSION;
  generatedAt: string;
  tenantId: string;
  range: { from: string; to: string };

  systemInfo: {
    productName: string;
    productVersion: string;
    hashAlgorithm: string;
    hashChainVersion: number;
    signingAlgorithm: string;
  };

  chainVerification: VerificationReport;

  humanOversight: {
    approvalRequests: {
      total: number;
      granted: number;
      denied: number;
      expired: number;
      averageResponseTimeMs: number | null;
    };
    guardrailTriggers: {
      total: number;
      byConditionType: Record<string, number>;
      byActionType: Record<string, number>;
    };
  };

  incidents: {
    totalErrors: number;
    totalCritical: number;
    alertsTriggered: number;
    alertsResolved: number;
    items: IncidentEntry[];
  };

  costUsage: {
    totalSessions: number;
    uniqueAgents: number;
    totalLlmCalls: number;
    totalToolCalls: number;
    totalCostUsd: number;
    costByAgent: Record<string, number>;
  };

  retention: {
    configuredRetentionDays: number;
    minimumRetentionDays: number;
    earliestEventTimestamp: string | null;
    latestEventTimestamp: string | null;
    chainIntact: boolean;
    dataGapDetected: boolean;
  };

  signature: string | null;
}

// ─── Builder ────────────────────────────────────────────────

export class ComplianceReportBuilder {
  constructor(
    private eventRepo: EventRepository,
    private analyticsRepo: AnalyticsRepository,
    private guardrailStore: GuardrailStore,
    private signingKey?: string,
    private configuredRetentionDays: number = 90,
    private minimumRetentionDays: number = 180,
    private maxIncidentItems: number = 1000,
  ) {}

  async build(tenantId: string, from: string, to: string): Promise<ComplianceReport> {
    // 1. Chain verification
    const chainVerification = await runVerification(this.eventRepo, {
      tenantId,
      from,
      to,
      signingKey: this.signingKey,
    });

    // 2. Human oversight
    const approvalStats = this.eventRepo.getApprovalStats(tenantId, from, to);
    const guardrailTriggers = this.guardrailStore.getTriggerStats(tenantId, from, to);

    // 3. Incidents
    const incidentRows = this.eventRepo.getIncidentEvents(tenantId, from, to, this.maxIncidentItems);
    let totalErrors = 0;
    let totalCritical = 0;
    let alertsTriggered = 0;
    let alertsResolved = 0;
    const incidentItems: IncidentEntry[] = [];

    for (const row of incidentRows) {
      if (row.severity === 'error') totalErrors++;
      if (row.severity === 'critical') totalCritical++;
      if (row.eventType === 'alert_triggered') alertsTriggered++;
      if (row.eventType === 'alert_resolved') alertsResolved++;

      let summary = '';
      try {
        const payload = JSON.parse(row.payload);
        summary = payload.message || payload.error || payload.summary || row.eventType;
      } catch {
        summary = row.eventType;
      }

      incidentItems.push({
        eventId: row.id,
        timestamp: row.timestamp,
        sessionId: row.sessionId,
        agentId: row.agentId,
        eventType: row.eventType,
        severity: row.severity,
        summary,
      });
    }

    // 4. Cost/usage analytics
    const totalLlmCalls = await this.eventRepo.countEvents({
      tenantId,
      from,
      to,
      eventType: 'llm_call',
    });
    const analytics = await this.analyticsRepo.getAnalytics({
      from,
      to,
      granularity: 'day',
      tenantId,
    });
    const costByAgent = this.analyticsRepo.getCostByAgent(tenantId, from, to);

    // 5. Storage stats for retention
    const stats = await this.analyticsRepo.getStats(tenantId);

    // 6. Assemble report body
    const reportBody: Omit<ComplianceReport, 'signature'> = {
      version: COMPLIANCE_REPORT_VERSION,
      generatedAt: new Date().toISOString(),
      tenantId,
      range: { from, to },

      systemInfo: {
        productName: 'AgentLens',
        productVersion: '0.1.0',
        hashAlgorithm: 'SHA-256',
        hashChainVersion: HASH_VERSION,
        signingAlgorithm: 'HMAC-SHA256',
      },

      chainVerification,

      humanOversight: {
        approvalRequests: {
          total: approvalStats.total,
          granted: approvalStats.granted,
          denied: approvalStats.denied,
          expired: approvalStats.expired,
          averageResponseTimeMs: approvalStats.avgResponseTimeMs,
        },
        guardrailTriggers,
      },

      incidents: {
        totalErrors,
        totalCritical,
        alertsTriggered,
        alertsResolved,
        items: incidentItems,
      },

      costUsage: {
        totalSessions: analytics.totals.uniqueSessions,
        uniqueAgents: analytics.totals.uniqueAgents,
        totalLlmCalls,
        totalToolCalls: analytics.totals.toolCallCount,
        totalCostUsd: analytics.totals.totalCostUsd,
        costByAgent,
      },

      retention: {
        configuredRetentionDays: this.configuredRetentionDays,
        minimumRetentionDays: this.minimumRetentionDays,
        earliestEventTimestamp: stats.oldestEvent ?? null,
        latestEventTimestamp: stats.newestEvent ?? null,
        chainIntact: chainVerification.verified,
        dataGapDetected: chainVerification.brokenChains.length > 0,
      },
    };

    // 7. Sign
    let signature: string | null = null;
    if (this.signingKey) {
      const canonical = JSON.stringify(reportBody);
      signature = 'hmac-sha256:' + createHmac('sha256', this.signingKey).update(canonical).digest('hex');
    }

    return { ...reportBody, signature };
  }
}
