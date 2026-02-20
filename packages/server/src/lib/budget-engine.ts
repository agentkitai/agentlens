/**
 * Budget Engine — Cost Budget Enforcement (Feature 5 — Story 3)
 *
 * Subscribes to event_ingested on EventBus, evaluates applicable budgets
 * on cost-relevant events, and executes breach actions via executeAction().
 */

import type { AgentLensEvent, CostBudget, CostBudgetState, IEventStore } from '@agentlensai/core';
import type { SqliteDb } from '../db/index.js';
import { CostBudgetStore } from '../db/cost-budget-store.js';
import { executeAction } from './guardrails/actions.js';
import { eventBus, type BusEvent } from './event-bus.js';
import { createLogger } from './logger.js';

const log = createLogger('BudgetEngine');

export class BudgetEngine {
  private store: CostBudgetStore;
  private eventStore: IEventStore;
  private listener: ((event: BusEvent) => void) | null = null;
  private started = false;

  constructor(eventStore: IEventStore, db: SqliteDb) {
    this.eventStore = eventStore;
    this.store = new CostBudgetStore(db);
  }

  start(): void {
    if (this.started) return;
    this.listener = (busEvent: BusEvent) => {
      if (busEvent.type === 'event_ingested') {
        this.evaluateEvent(busEvent.event).catch((err) => {
          log.error('budget evaluation error', { error: err instanceof Error ? err.message : String(err) });
        });
      }
    };
    eventBus.on('event_ingested', this.listener);
    this.started = true;
  }

  stop(): void {
    if (this.listener) {
      eventBus.off('event_ingested', this.listener);
      this.listener = null;
    }
    this.started = false;
  }

  getStore(): CostBudgetStore {
    return this.store;
  }

  async evaluateEvent(event: AgentLensEvent): Promise<void> {
    // Only evaluate cost-relevant events
    if (event.eventType !== 'llm_response' && event.eventType !== 'cost_tracked') return;

    const budgets = this.store.listEnabledBudgets(event.tenantId, event.agentId);
    if (budgets.length === 0) return;

    for (const budget of budgets) {
      try {
        await this.evaluateBudget(budget, event);
      } catch (err) {
        log.error(`budget ${budget.id} error`, { error: err instanceof Error ? err.message : String(err) });
      }
    }
  }

  private async evaluateBudget(budget: CostBudget, event: AgentLensEvent): Promise<void> {
    // For agent-scoped budgets, check that agentId matches
    if (budget.scope === 'agent' && budget.agentId !== event.agentId) return;

    const periodStart = this.getPeriodStart(budget.period);
    const currentSpend = await this.computeCurrentSpend(budget, event);

    // Update state
    const existingState = this.store.getState(budget.tenantId, budget.id);
    const newState: CostBudgetState = {
      budgetId: budget.id,
      tenantId: budget.tenantId,
      breachCount: existingState?.breachCount ?? 0,
      lastBreachAt: existingState?.lastBreachAt,
      currentSpend,
      periodStart,
    };

    if (currentSpend < budget.limitUsd) {
      this.store.upsertState(newState);
      return;
    }

    // Budget breached — check cooldown
    if (this.isBreachCooldownActive(budget, existingState)) {
      this.store.upsertState(newState);
      return;
    }

    // Execute breach action
    await this.executeBreach(budget, currentSpend, event);

    // Update state with breach
    newState.lastBreachAt = new Date().toISOString();
    newState.breachCount = (existingState?.breachCount ?? 0) + 1;
    this.store.upsertState(newState);
  }

  private async computeCurrentSpend(budget: CostBudget, event: AgentLensEvent): Promise<number> {
    if (budget.scope === 'session' && budget.period === 'session') {
      // Session scope: get session's totalCostUsd
      const session = await this.eventStore.getSession(event.sessionId);
      return session?.totalCostUsd ?? 0;
    }

    // Agent scope: sum across sessions in period window
    const from = this.getPeriodStart(budget.period);
    return this.eventStore.sumSessionCost({
      agentId: budget.agentId!,
      from,
      tenantId: budget.tenantId,
    });
  }

  getPeriodStart(period: string): string {
    const now = new Date();
    switch (period) {
      case 'session':
        return now.toISOString(); // Not meaningful for session scope
      case 'daily': {
        const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
        return d.toISOString();
      }
      case 'weekly': {
        // Monday of current week UTC
        const day = now.getUTCDay();
        const diff = day === 0 ? 6 : day - 1; // Monday = 0 offset
        const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - diff));
        return d.toISOString();
      }
      case 'monthly': {
        const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
        return d.toISOString();
      }
      default:
        return now.toISOString();
    }
  }

  private isBreachCooldownActive(budget: CostBudget, state: CostBudgetState | null): boolean {
    if (!state?.lastBreachAt) return false;

    const periodStart = this.getPeriodStart(budget.period);

    // For session scope, no cooldown between sessions (each session is independent)
    if (budget.period === 'session') {
      // cooldown is per-session — but we don't track per-session state here
      // so we allow one breach per evaluation
      return true; // Already breached in this session check cycle
    }

    // For period-based budgets: if lastBreachAt is within the current period, skip
    return state.lastBreachAt >= periodStart;
  }

  private async executeBreach(budget: CostBudget, currentSpend: number, event: AgentLensEvent): Promise<void> {
    const message = `Budget breached: $${currentSpend.toFixed(4)} >= $${budget.limitUsd} (${budget.scope}/${budget.period})`;

    if (budget.onBreach === 'alert') {
      // Emit alert on EventBus
      eventBus.emit({
        type: 'alert_triggered',
        rule: {
          id: budget.id,
          name: `budget:${budget.scope}:${budget.period}`,
          enabled: true,
          condition: 'cost_exceeds' as const,
          threshold: budget.limitUsd,
          windowMinutes: 0,
          scope: budget.agentId ? { agentId: budget.agentId } : {},
          notifyChannels: [],
          createdAt: budget.createdAt,
          updatedAt: budget.updatedAt,
          tenantId: budget.tenantId,
        },
        history: {
          id: `cb_${Date.now()}`,
          ruleId: budget.id,
          triggeredAt: new Date().toISOString(),
          currentValue: currentSpend,
          threshold: budget.limitUsd,
          message,
          tenantId: budget.tenantId,
        },
        timestamp: new Date().toISOString(),
      });
      return;
    }

    // For pause_agent / downgrade_model, use executeAction with synthetic guardrail rule
    const syntheticRule = {
      id: budget.id,
      tenantId: budget.tenantId,
      name: `budget:${budget.scope}:${budget.period}`,
      enabled: true,
      conditionType: 'cost_limit' as const,
      conditionConfig: { maxCostUsd: budget.limitUsd },
      actionType: budget.onBreach as 'pause_agent' | 'downgrade_model',
      actionConfig: budget.onBreach === 'downgrade_model'
        ? { targetModel: budget.downgradeTargetModel }
        : {},
      cooldownMinutes: 0,
      dryRun: false,
      createdAt: budget.createdAt,
      updatedAt: budget.updatedAt,
    };

    const conditionResult = {
      triggered: true,
      currentValue: currentSpend,
      threshold: budget.limitUsd,
      message,
    };

    await executeAction(syntheticRule, conditionResult, event.agentId);
  }
}
