/**
 * Guardrail Evaluation Engine (v0.8.0 — Story 1.3)
 *
 * Subscribes to EventBus and evaluates guardrail rules asynchronously.
 * Never blocks the event POST response.
 *
 * ┌─────────────────────────────────────────────────────────────────────┐
 * │                   EVALUATION PIPELINE FLOW                         │
 * ├─────────────────────────────────────────────────────────────────────┤
 * │                                                                     │
 * │  1. EventBus emits "event_ingested"                                │
 * │  2. engine.evaluateEvent() is called (async, non-blocking)         │
 * │  3. Fetch all enabled rules for (tenantId, agentId)                │
 * │  4. For EACH rule, run evaluateRule():                             │
 * │                                                                     │
 * │     Step 0 — Defense-in-depth: skip if rule.enabled === false      │
 * │     Step 1 — COOLDOWN CHECK:                                       │
 * │              If (now − lastTriggeredAt) < cooldownMinutes → skip.  │
 * │              Prevents alert storms from repeated triggers.         │
 * │     Step 2 — CONDITION EVALUATION:                                 │
 * │              Delegates to conditions.ts (see that file for each    │
 * │              condition type's formula). Returns { triggered,       │
 * │              currentValue, threshold, message }.                   │
 * │     Step 3 — STATE UPDATE (currentValue, lastEvaluatedAt):         │
 * │              Always persisted so dashboards can show latest value.  │
 * │     Step 4 — If NOT triggered → return (state already saved).      │
 * │     Step 5 — ACTION EXECUTION:                                     │
 * │              If rule.dryRun → log only, no side-effects.           │
 * │              Otherwise delegate to actions.ts (pause_agent,        │
 * │              notify_webhook, downgrade_model, agentgate_policy).   │
 * │     Step 6 — TRIGGER HISTORY: insert a record with condition       │
 * │              value, threshold, action result, and event metadata.  │
 * │     Step 7 — Update state: increment triggerCount, set             │
 * │              lastTriggeredAt (starts new cooldown window).         │
 * │                                                                     │
 * │  Error handling: each rule evaluation is wrapped in try/catch so   │
 * │  one failing rule never blocks others.                             │
 * └─────────────────────────────────────────────────────────────────────┘
 */

import { ulid } from 'ulid';
import type { AgentLensEvent, GuardrailRule, GuardrailState } from '@agentlensai/core';
import type { IEventStore } from '@agentlensai/core';
import type { SqliteDb } from '../../db/index.js';
import { GuardrailStore } from '../../db/guardrail-store.js';
import { evaluateCondition } from './conditions.js';
import { executeAction } from './actions.js';
import { eventBus, type BusEvent } from '../event-bus.js';
import { createLogger } from '../logger.js';

const log = createLogger('GuardrailEngine');

export class GuardrailEngine {
  private store: GuardrailStore;
  private eventStore: IEventStore;
  private listener: ((event: BusEvent) => void) | null = null;
  private started = false;

  constructor(eventStore: IEventStore, db: SqliteDb) {
    this.eventStore = eventStore;
    this.store = new GuardrailStore(db);
  }

  start(): void {
    if (this.started) return;
    this.listener = (busEvent: BusEvent) => {
      if (busEvent.type === 'event_ingested') {
        this.evaluateEvent(busEvent.event).catch((err) => {
          log.error('evaluation error', { error: err instanceof Error ? err.message : String(err) });
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

  getStore(): GuardrailStore {
    return this.store;
  }

  async evaluateEvent(event: AgentLensEvent): Promise<void> {
    const rules = this.store.listEnabledRules(event.tenantId, event.agentId);
    if (rules.length === 0) return;

    for (const rule of rules) {
      try {
        await this.evaluateRule(rule, event);
      } catch (err) {
        log.error(`rule ${rule.id} error`, { error: err instanceof Error ? err.message : String(err) });
      }
    }
  }

  private async evaluateRule(rule: GuardrailRule, event: AgentLensEvent): Promise<void> {
    const now = new Date();

    // 0. Check enabled (defense-in-depth — listEnabledRules already filters, but verify)
    if (!rule.enabled) return;

    // 1. Check cooldown
    if (this.isInCooldown(rule, now)) return;

    // 2. Evaluate condition
    const conditionResult = await evaluateCondition(this.eventStore, rule, event.agentId, event.sessionId);

    // 3. Update state
    const existingState = this.store.getState(rule.tenantId, rule.id);
    const newState: GuardrailState = {
      ruleId: rule.id,
      tenantId: rule.tenantId,
      lastEvaluatedAt: now.toISOString(),
      currentValue: conditionResult.currentValue,
      triggerCount: existingState?.triggerCount ?? 0,
      lastTriggeredAt: existingState?.lastTriggeredAt,
    };

    if (!conditionResult.triggered) {
      this.store.upsertState(newState);
      return;
    }

    // 4. Execute action (or dry-run)
    let actionResult = 'dry_run';
    let actionExecuted = false;

    if (!rule.dryRun) {
      const result = await executeAction(rule, conditionResult, event.agentId);
      actionResult = result.result;
      actionExecuted = result.success;
    }

    // 5. Record trigger history
    this.store.insertTrigger({
      id: ulid(),
      ruleId: rule.id,
      tenantId: rule.tenantId,
      triggeredAt: now.toISOString(),
      conditionValue: conditionResult.currentValue,
      conditionThreshold: conditionResult.threshold,
      actionExecuted,
      actionResult,
      metadata: {
        agentId: event.agentId,
        sessionId: event.sessionId,
        eventId: event.id,
        dryRun: rule.dryRun,
        message: conditionResult.message,
      },
    });

    // 6. Update state
    newState.triggerCount = (existingState?.triggerCount ?? 0) + 1;
    newState.lastTriggeredAt = now.toISOString();
    this.store.upsertState(newState);
  }

  private isInCooldown(rule: GuardrailRule, now: Date): boolean {
    if (rule.cooldownMinutes <= 0) return false;
    const state = this.store.getState(rule.tenantId, rule.id);
    if (!state?.lastTriggeredAt) return false;
    const lastTriggered = new Date(state.lastTriggeredAt);
    return now.getTime() - lastTriggered.getTime() < rule.cooldownMinutes * 60 * 1000;
  }
}
