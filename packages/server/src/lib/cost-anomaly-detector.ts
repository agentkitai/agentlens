/**
 * Cost Anomaly Detector (Feature 5 — Story 4)
 *
 * Subscribes to session_updated on EventBus, checks completed sessions
 * against 7-day baseline, emits alert_triggered on anomaly.
 */

import type { IEventStore, Session } from '@agentlensai/core';
import { CostBudgetStore } from '../db/cost-budget-store.js';
import { eventBus, type BusEvent } from './event-bus.js';
import { createLogger } from './logger.js';

const log = createLogger('CostAnomalyDetector');

const DEFAULT_MULTIPLIER = 3.0;
const DEFAULT_MIN_SESSIONS = 5;

export class CostAnomalyDetector {
  private store: CostBudgetStore;
  private eventStore: IEventStore;
  private listener: ((event: BusEvent) => void) | null = null;
  private started = false;

  constructor(eventStore: IEventStore, store: CostBudgetStore) {
    this.eventStore = eventStore;
    this.store = store;
  }

  start(): void {
    if (this.started) return;
    this.listener = (busEvent: BusEvent) => {
      if (busEvent.type === 'session_updated') {
        const session = busEvent.session;
        if (session.status === 'completed') {
          this.checkSession(session, session.tenantId).catch((err) => {
            log.error('anomaly check error', { error: err instanceof Error ? err.message : String(err) });
          });
        }
      }
    };
    eventBus.on('session_updated', this.listener);
    this.started = true;
  }

  stop(): void {
    if (this.listener) {
      eventBus.off('session_updated', this.listener);
      this.listener = null;
    }
    this.started = false;
  }

  async checkSession(session: Session, tenantId: string): Promise<void> {
    // Skip zero-cost sessions
    if (!session.totalCostUsd || session.totalCostUsd === 0) return;

    // Load config
    const config = this.store.getAnomalyConfig(tenantId);
    const multiplier = config?.multiplier ?? DEFAULT_MULTIPLIER;
    const minSessions = config?.minSessions ?? DEFAULT_MIN_SESSIONS;
    const enabled = config?.enabled ?? true;

    if (!enabled) return;

    // Compute baseline
    const baseline = await this.computeBaseline(tenantId, session.agentId);

    // Cold start protection
    if (baseline.count < minSessions) return;

    // Check anomaly
    if (baseline.avg > 0 && session.totalCostUsd > multiplier * baseline.avg) {
      log.info(`Anomaly detected: session ${session.id} cost $${session.totalCostUsd.toFixed(4)} > ${multiplier}× avg $${baseline.avg.toFixed(4)}`);

      eventBus.emit({
        type: 'alert_triggered',
        rule: {
          id: `anomaly:${session.agentId}`,
          name: `cost_anomaly:${session.agentId}`,
          enabled: true,
          condition: 'cost_exceeds' as const,
          threshold: multiplier * baseline.avg,
          windowMinutes: 0,
          scope: { agentId: session.agentId },
          notifyChannels: [],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          tenantId,
        },
        history: {
          id: `ca_${Date.now()}`,
          ruleId: `anomaly:${session.agentId}`,
          triggeredAt: new Date().toISOString(),
          currentValue: session.totalCostUsd,
          threshold: multiplier * baseline.avg,
          message: `Cost anomaly: session ${session.id} cost $${session.totalCostUsd.toFixed(4)} exceeds ${multiplier}× 7-day avg $${baseline.avg.toFixed(4)}`,
          tenantId,
        },
        timestamp: new Date().toISOString(),
      });
    }
  }

  async computeBaseline(tenantId: string, agentId: string): Promise<{ avg: number; count: number }> {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const result = await this.eventStore.querySessions({
      agentId,
      tenantId,
      from: sevenDaysAgo,
      status: 'completed',
      limit: 1000,
    });

    const sessions = result.sessions;
    if (sessions.length === 0) return { avg: 0, count: 0 };

    const totalCost = sessions.reduce((sum, s) => sum + (s.totalCostUsd || 0), 0);
    return { avg: totalCost / sessions.length, count: sessions.length };
  }
}
