# AgentLens v0.8.0 — Technical Architecture Document

## Phase 3: Proactive Guardrails & Framework Plugins

**Date:** 2026-02-08
**Author:** Winston (Architect)
**Status:** Draft
**PRD:** `/phase3/prd.md` (67 functional + 30 non-functional requirements)

---

## Table of Contents

1. [System Architecture Overview](#1-system-architecture-overview)
2. [Data Models](#2-data-models)
3. [Guardrail Evaluation Pipeline](#3-guardrail-evaluation-pipeline)
4. [Action Handlers](#4-action-handlers)
5. [Plugin Architecture](#5-plugin-architecture)
6. [REST API Design](#6-rest-api-design)
7. [MCP Tool Design](#7-mcp-tool-design)
8. [Dashboard Components](#8-dashboard-components)
9. [Error Handling & Fail-Safety](#9-error-handling--fail-safety)
10. [Performance Considerations](#10-performance-considerations)
11. [Database Schema](#11-database-schema)
12. [Testing Strategy](#12-testing-strategy)
13. [Migration & Compatibility](#13-migration--compatibility)

---

## 1. System Architecture Overview

### 1.1 High-Level Architecture

Phase 3 adds two major subsystems to the existing AgentLens architecture:

1. **Proactive Guardrails** — A server-side engine that subscribes to the event bus, evaluates configurable rules against incoming events, and dispatches actions (pause, webhook, model downgrade, AgentGate policy).

2. **Framework Plugins** — Python SDK extensions that hook into AI framework lifecycle callbacks (LangChain, CrewAI, AutoGen, Semantic Kernel) and emit standardised AgentLens events with rich framework-specific metadata.

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                              Python SDK                                       │
│  ┌──────────┐  ┌──────────────┐  ┌──────────┐  ┌──────────┐  ┌───────────┐  │
│  │ OpenAI   │  │ Anthropic    │  │LangChain │  │ CrewAI   │  │ AutoGen   │  │
│  │ Patcher  │  │ Patcher      │  │ Plugin   │  │ Plugin   │  │ Plugin    │  │
│  └────┬─────┘  └──────┬───────┘  └────┬─────┘  └────┬─────┘  └─────┬─────┘  │
│       │               │               │             │              │         │
│       ▼               ▼               ▼             ▼              ▼         │
│  ┌──────────────────────────────────────────────────────────────────────┐     │
│  │                    BaseFrameworkPlugin                                │     │
│  │  _send_event() · _send_custom_event() · _send_llm_call()           │     │
│  │  _send_tool_call() · _send_tool_response() · _send_tool_error()    │     │
│  └────────────────────────┬─────────────────────────────────────────────┘     │
│                           │ HTTP POST /api/events                             │
│  ┌────────────┐           │                                                   │
│  │ SK Plugin  │───────────┤                                                   │
│  └────────────┘           │                                                   │
└───────────────────────────┼──────────────────────────────────────────────────┘
                            │
                            ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│                           Server (Hono)                                       │
│                                                                               │
│  ┌───────────────────┐    ┌───────────────────────────────────────────────┐   │
│  │ Ingest Routes     │───▶│ EventBus                                      │   │
│  │ POST /api/events  │    │  emit('event_ingested', { event })           │   │
│  │ Returns 201       │    └──────┬──────────────┬──────────────┬──────────┘   │
│  │ immediately       │           │              │              │              │
│  └──────┬────────────┘           │              │              │              │
│         │                        ▼              ▼              ▼              │
│         │              ┌──────────────┐  ┌────────────┐  ┌────────────┐      │
│         │              │ Guardrail    │  │ SSE Stream │  │ Alert      │      │
│         │              │ Engine       │  │ (existing) │  │ Engine     │      │
│         │              │ (NEW)        │  │            │  │ (existing) │      │
│         │              └──────┬───────┘  └────────────┘  └────────────┘      │
│         │                     │                                               │
│         │           ┌─────────┼──────────────────────┐                       │
│         │           │         ▼                      │                       │
│         │           │  ConditionEvaluators            │                       │
│         │           │  ├─ ErrorRateEvaluator          │                       │
│         │           │  ├─ CostLimitEvaluator          │                       │
│         │           │  ├─ HealthScoreEvaluator        │                       │
│         │           │  └─ CustomMetricEvaluator       │                       │
│         │           │                                 │                       │
│         │           │  ActionHandlers                 │                       │
│         │           │  ├─ PauseAgentHandler            │                       │
│         │           │  ├─ WebhookHandler               │                       │
│         │           │  ├─ ModelDowngradeHandler         │                       │
│         │           │  └─ AgentGatePolicyHandler        │                       │
│         │           └─────────────────────────────────┘                       │
│         │                                                                     │
│  ┌──────▼──────────┐    ┌───────────────────┐    ┌────────────────────────┐  │
│  │ Guardrail       │    │ GuardrailStore    │    │ Guardrail REST Routes │  │
│  │ State in        │◀──▶│ (existing CRUD)   │◀──▶│ (NEW)                 │  │
│  │ SQLite          │    │                   │    │                       │  │
│  └─────────────────┘    └───────────────────┘    └────────────────────────┘  │
│                                                                               │
│  ┌─────────────────────────────────────────────────────────────────────────┐  │
│  │                    Dashboard (React)                                     │  │
│  │  ┌────────────────┐  ┌──────────────────┐  ┌────────────────────────┐  │  │
│  │  │ GuardrailList  │  │ GuardrailDetail  │  │ GuardrailCreateEdit   │  │  │
│  │  │ Page           │  │ Page             │  │ Form                  │  │  │
│  │  └────────────────┘  └──────────────────┘  └────────────────────────┘  │  │
│  └─────────────────────────────────────────────────────────────────────────┘  │
│                                                                               │
│  ┌─────────────────────────────────────────────────────────────────────────┐  │
│  │                    MCP Package                                          │  │
│  │  ┌─────────────────────┐                                                │  │
│  │  │ agentlens_guardrails│                                                │  │
│  │  │ tool (NEW)          │                                                │  │
│  │  └─────────────────────┘                                                │  │
│  └─────────────────────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────────────────┘
```

### 1.2 Design Principles

1. **Async-first, never block ingestion.** Guardrail evaluation subscribes to the `EventBus` and runs after the event POST returns 201. The ingestion pipeline is sacred — we never add latency to it.

2. **Events are always accepted.** Even when an agent is paused, events flow in. Observability data is never discarded. The `pause_agent` action sets a flag; it does not reject events.

3. **Dry-run by default.** New guardrail rules default to `dryRun: true` (per PRD FR-G1.5). Users observe condition evaluations in the trigger history before enabling enforcement.

4. **Absolute fail-safety for plugins.** Every plugin method wraps all logic in `try/except` (Python) or `try/catch` (TypeScript). Plugin failures MUST NOT propagate to user code. This is not a best-effort aspiration — it's a hard architectural constraint.

5. **Build on what exists.** The mega-agent already implemented core types, Zod schemas, the GuardrailStore, and database migrations. This architecture builds on those foundations without redesigning them.

6. **Boring technology for stability.** SQLite for state, synchronous evaluation in the Node.js event loop (no worker threads), simple HTTP for webhooks. No new infrastructure dependencies.

### 1.3 What Already Exists (From Mega-Agent Implementation)

| Component | Location | Status | Notes |
|-----------|----------|--------|-------|
| `GuardrailRule`, `GuardrailState`, `GuardrailTriggerHistory`, `GuardrailConditionResult` types | `packages/core/src/types.ts` | ✅ Complete | Use as-is (NFR-27) |
| Zod schemas: `CreateGuardrailRuleSchema`, `UpdateGuardrailRuleSchema`, `GuardrailRuleSchema` | `packages/core/src/schemas.ts` | ✅ Complete | Use as-is |
| `GuardrailStore` (CRUD for rules, state, trigger history) | `packages/server/src/db/guardrail-store.ts` | ✅ Complete | Use as-is |
| Database tables + indexes | `packages/server/src/db/migrate.ts` | ✅ Complete | Use as-is |
| `BaseFrameworkPlugin` | `packages/python-sdk/src/agentlensai/integrations/base.py` | ✅ Complete | Extend, don't replace |
| `AgentLensCallbackHandler` (LangChain) | `packages/python-sdk/src/agentlensai/integrations/langchain.py` | ✅ Partial | Enhance with chain/agent/retriever callbacks |
| `EventBus` with `event_ingested` event type | `packages/server/src/lib/event-bus.ts` | ✅ Complete | Subscribe to it |

### 1.4 What This Architecture Adds

| Component | Location | Description |
|-----------|----------|-------------|
| `GuardrailEngine` | `packages/server/src/lib/guardrails/engine.ts` | Core orchestrator: event bus subscription, rule loading, condition → action pipeline |
| Condition evaluators (4 types) | `packages/server/src/lib/guardrails/conditions/` | One evaluator per condition type |
| Action handlers (4 types) | `packages/server/src/lib/guardrails/actions/` | One handler per action type |
| Guardrail REST routes | `packages/server/src/routes/guardrails.ts` | 11 endpoints (CRUD + enable/disable/reset/history/unpause) |
| `agentlens_guardrails` MCP tool | `packages/mcp/src/tools/guardrails.ts` | List, status, history, create, update, enable, disable |
| Dashboard guardrail pages | `packages/dashboard/src/pages/Guardrails*.tsx` | List, detail, create/edit form |
| CrewAI plugin | `packages/python-sdk/src/agentlensai/integrations/crewai.py` | Crew/agent/task lifecycle capture |
| AutoGen plugin | `packages/python-sdk/src/agentlensai/integrations/autogen.py` | Conversation/message/tool capture |
| Semantic Kernel plugin | `packages/python-sdk/src/agentlensai/integrations/semantic_kernel.py` | Filter-based function/LLM capture |
| Framework auto-detection | `packages/python-sdk/src/agentlensai/_detection.py` | Import-based detection in `init()` |
| Model override support | `packages/python-sdk/src/agentlensai/_override.py` | SDK-level model substitution from guardrail actions |

---

## 2. Data Models

### 2.1 Existing Types (Use As-Is)

The following types are already defined in `packages/core/src/types.ts` and validated by schemas in `packages/core/src/schemas.ts`. **Do not modify them.**

```typescript
// Already in types.ts — these are our foundation
interface GuardrailRule { id, tenantId, name, description?, enabled, conditionType, conditionConfig, actionType, actionConfig, agentId?, cooldownMinutes, dryRun, createdAt, updatedAt }
interface GuardrailState { ruleId, tenantId, lastTriggeredAt?, triggerCount, lastEvaluatedAt?, currentValue? }
interface GuardrailTriggerHistory { id, ruleId, tenantId, triggeredAt, conditionValue, conditionThreshold, actionExecuted, actionResult?, metadata }
interface GuardrailConditionResult { triggered, currentValue, threshold, message }

type GuardrailConditionType = 'error_rate_threshold' | 'cost_limit' | 'health_score_threshold' | 'custom_metric'
type GuardrailActionType = 'pause_agent' | 'notify_webhook' | 'downgrade_model' | 'agentgate_policy'
```

### 2.2 Condition Config Schemas (New — `@agentlensai/core`)

Define typed condition config interfaces and Zod schemas to validate the `conditionConfig` field:

```typescript
// packages/core/src/guardrail-configs.ts

/** error_rate_threshold condition config */
export interface ErrorRateConditionConfig {
  /** Error rate percentage threshold (0-100). Triggers when rate >= threshold */
  threshold: number;
  /** Sliding window in minutes (default: 5) */
  windowMinutes: number;
}

/** cost_limit condition config */
export interface CostLimitConditionConfig {
  /** Maximum cost in USD */
  maxCostUsd: number;
  /** Scope: 'session' (cumulative session cost) or 'daily' (UTC day agent total) */
  scope: 'session' | 'daily';
}

/** health_score_threshold condition config */
export interface HealthScoreConditionConfig {
  /** Minimum acceptable health score (0-100). Triggers when score < minScore */
  minScore: number;
  /** Window in days for health computation (default: 7) */
  windowDays: number;
}

/** custom_metric condition config */
export interface CustomMetricConditionConfig {
  /** JSON key path into event metadata (e.g., 'response_time_ms') */
  metricKeyPath: string;
  /** Comparison operator */
  operator: 'gt' | 'lt' | 'gte' | 'lte' | 'eq';
  /** Threshold value to compare against */
  value: number;
  /** Sliding window in minutes (default: 5) */
  windowMinutes: number;
}

// Corresponding Zod schemas
export const ErrorRateConditionConfigSchema = z.object({
  threshold: z.number().min(0).max(100),
  windowMinutes: z.number().int().min(1).max(1440).default(5),
});

export const CostLimitConditionConfigSchema = z.object({
  maxCostUsd: z.number().positive(),
  scope: z.enum(['session', 'daily']),
});

export const HealthScoreConditionConfigSchema = z.object({
  minScore: z.number().min(0).max(100),
  windowDays: z.number().int().min(1).max(90).default(7),
});

export const CustomMetricConditionConfigSchema = z.object({
  metricKeyPath: z.string().min(1),
  operator: z.enum(['gt', 'lt', 'gte', 'lte', 'eq']),
  value: z.number(),
  windowMinutes: z.number().int().min(1).max(1440).default(5),
});
```

### 2.3 Action Config Schemas (New — `@agentlensai/core`)

```typescript
// packages/core/src/guardrail-configs.ts (continued)

/** pause_agent action config */
export interface PauseAgentActionConfig {
  /** Optional human-readable message explaining why the agent was paused */
  message?: string;
}

/** notify_webhook action config */
export interface WebhookActionConfig {
  /** Target URL (HTTPS required in production, HTTP allowed in dev) */
  url: string;
  /** Optional custom headers to include in the POST */
  headers?: Record<string, string>;
  /** Optional secret for HMAC signature verification */
  secret?: string;
}

/** downgrade_model action config */
export interface DowngradeModelActionConfig {
  /** Target model to downgrade to (e.g., 'gpt-4o-mini') */
  targetModel: string;
  /** Optional message explaining the downgrade */
  message?: string;
}

/** agentgate_policy action config */
export interface AgentGatePolicyActionConfig {
  /** AgentGate API URL */
  agentgateUrl: string;
  /** Policy ID to create/update */
  policyId: string;
  /** Policy action (e.g., 'block_tool', 'require_approval') */
  action: string;
  /** Additional policy parameters */
  params?: Record<string, unknown>;
}

// Corresponding Zod schemas
export const PauseAgentActionConfigSchema = z.object({
  message: z.string().max(500).optional(),
});

export const WebhookActionConfigSchema = z.object({
  url: z.string().url(),
  headers: z.record(z.string()).optional(),
  secret: z.string().optional(),
});

export const DowngradeModelActionConfigSchema = z.object({
  targetModel: z.string().min(1),
  message: z.string().max(500).optional(),
});

export const AgentGatePolicyActionConfigSchema = z.object({
  agentgateUrl: z.string().url(),
  policyId: z.string().min(1),
  action: z.string().min(1),
  params: z.record(z.unknown()).optional(),
});
```

### 2.4 Agent Model Extension

The `agents` table needs a new column to support `modelOverride` and `paused` state from guardrails:

```typescript
// Additions to the Agent type (packages/core/src/types.ts)
export interface Agent {
  // ... existing fields ...

  /** Set by downgrade_model guardrail action. SDK reads this on each LLM call. */
  modelOverride?: string;
  /** Set by pause_agent guardrail action. Cleared by manual unpause. */
  pausedAt?: string;
  /** Human-readable reason for pause (from guardrail rule) */
  pauseReason?: string;
}
```

Migration adds these columns:

```sql
ALTER TABLE agents ADD COLUMN model_override TEXT;
ALTER TABLE agents ADD COLUMN paused_at TEXT;
ALTER TABLE agents ADD COLUMN pause_reason TEXT;
```

### 2.5 Webhook Payload Schema

The standardised payload sent by `notify_webhook` actions (FR-G3.3):

```typescript
export interface GuardrailWebhookPayload {
  /** Event type identifier */
  event: 'guardrail_triggered';
  /** Guardrail rule details */
  rule: {
    id: string;
    name: string;
    conditionType: GuardrailConditionType;
    actionType: GuardrailActionType;
  };
  /** Condition evaluation details */
  condition: {
    currentValue: number;
    threshold: number;
    message: string;
  };
  /** Scope context */
  context: {
    agentId: string;
    sessionId?: string;
    tenantId: string;
  };
  /** ISO 8601 timestamp */
  timestamp: string;
  /** Dry-run indicator */
  dryRun: boolean;
}
```

**Note:** Per NFR-14, webhook payloads do NOT include raw LLM prompt/response content — only metric values and identifiers.

---

## 3. Guardrail Evaluation Pipeline

### 3.1 Architecture

The `GuardrailEngine` is the core orchestrator. It subscribes to the `EventBus`, loads applicable rules, evaluates conditions, and dispatches actions.

```
packages/server/src/lib/guardrails/
├── engine.ts                    — GuardrailEngine (orchestrator)
├── conditions/
│   ├── index.ts                 — ConditionEvaluator interface + factory
│   ├── error-rate.ts            — ErrorRateEvaluator
│   ├── cost-limit.ts            — CostLimitEvaluator
│   ├── health-score.ts          — HealthScoreEvaluator
│   └── custom-metric.ts         — CustomMetricEvaluator
├── actions/
│   ├── index.ts                 — ActionHandler interface + factory
│   ├── pause-agent.ts           — PauseAgentHandler
│   ├── webhook.ts               — WebhookHandler
│   ├── model-downgrade.ts       — ModelDowngradeHandler
│   └── agentgate-policy.ts      — AgentGatePolicyHandler
└── __tests__/
    ├── engine.test.ts
    ├── conditions/
    └── actions/
```

### 3.2 GuardrailEngine

```typescript
// packages/server/src/lib/guardrails/engine.ts

import type { AgentLensEvent } from '@agentlensai/core';
import type { GuardrailStore } from '../../db/guardrail-store.js';
import type { IEventStore } from '@agentlensai/core';
import { eventBus, type EventIngestedEvent } from '../event-bus.js';
import { createConditionEvaluator } from './conditions/index.js';
import { createActionHandler } from './actions/index.js';

export class GuardrailEngine {
  private started = false;
  private consecutiveFailures = 0;
  private disabled = false;
  private static readonly MAX_CONSECUTIVE_FAILURES = 10;

  constructor(
    private readonly guardrailStore: GuardrailStore,
    private readonly eventStore: IEventStore,
    private readonly db: SqliteDb,
  ) {}

  /** Subscribe to event bus. Call once at server startup. */
  start(): void {
    if (this.started) return;
    this.started = true;
    eventBus.on('event_ingested', this.onEventIngested.bind(this));
  }

  /** Unsubscribe. For testing and graceful shutdown. */
  stop(): void {
    eventBus.off('event_ingested', this.onEventIngested.bind(this));
    this.started = false;
  }

  /** Event bus callback. Wrapped in top-level try/catch — NEVER throws. */
  private onEventIngested(busEvent: EventIngestedEvent): void {
    // Circuit breaker: if 10 consecutive evaluations failed, disable
    if (this.disabled) return;

    try {
      this.evaluateEvent(busEvent.event);
      this.consecutiveFailures = 0; // Reset on success
    } catch (error) {
      this.consecutiveFailures++;
      logger.error('GuardrailEngine: evaluation failed', {
        error,
        consecutiveFailures: this.consecutiveFailures,
      });

      if (this.consecutiveFailures >= GuardrailEngine.MAX_CONSECUTIVE_FAILURES) {
        this.disabled = true;
        logger.error(
          'GuardrailEngine: DISABLED after %d consecutive failures. Manual restart required.',
          this.consecutiveFailures,
        );
      }
    }
  }

  /** Core evaluation logic for a single event. */
  private evaluateEvent(event: AgentLensEvent): void {
    const tenantId = event.tenantId;
    const agentId = event.agentId;

    // 1. Load enabled rules for this tenant + agent
    const rules = this.guardrailStore.listEnabledRules(tenantId, agentId);
    if (rules.length === 0) return;

    const now = new Date();

    for (const rule of rules) {
      try {
        // 2. Check cooldown (cheapest check first)
        const state = this.guardrailStore.getState(tenantId, rule.id);
        if (state?.lastTriggeredAt) {
          const cooldownEnd = new Date(state.lastTriggeredAt);
          cooldownEnd.setMinutes(cooldownEnd.getMinutes() + rule.cooldownMinutes);
          if (now < cooldownEnd) continue; // Still in cooldown
        }

        // 3. Evaluate condition
        const evaluator = createConditionEvaluator(rule.conditionType);
        const result = evaluator.evaluate(rule, event, this.eventStore, this.db);

        // 4. Update state regardless of trigger
        this.guardrailStore.upsertState({
          ruleId: rule.id,
          tenantId,
          lastEvaluatedAt: now.toISOString(),
          currentValue: result.currentValue,
          triggerCount: state?.triggerCount ?? 0,
          lastTriggeredAt: state?.lastTriggeredAt,
        });

        // 5. If condition triggered
        if (result.triggered) {
          const actionExecuted = !rule.dryRun;

          // Execute action (unless dry-run)
          let actionResult = rule.dryRun ? 'dry_run' : undefined;
          if (!rule.dryRun) {
            const handler = createActionHandler(rule.actionType);
            try {
              handler.execute(rule, result, event);
              actionResult = 'success';
            } catch (actionError) {
              actionResult = `failed: ${actionError instanceof Error ? actionError.message : 'unknown'}`;
              logger.warn('GuardrailEngine: action execution failed', {
                ruleId: rule.id, actionType: rule.actionType, error: actionError,
              });
            }
          }

          // Record trigger history
          this.guardrailStore.insertTrigger({
            id: generateUlid(),
            ruleId: rule.id,
            tenantId,
            triggeredAt: now.toISOString(),
            conditionValue: result.currentValue,
            conditionThreshold: result.threshold,
            actionExecuted,
            actionResult,
            metadata: {
              eventId: event.id,
              agentId: event.agentId,
              sessionId: event.sessionId,
              conditionMessage: result.message,
            },
          });

          // Update state with trigger
          this.guardrailStore.upsertState({
            ruleId: rule.id,
            tenantId,
            lastTriggeredAt: now.toISOString(),
            lastEvaluatedAt: now.toISOString(),
            currentValue: result.currentValue,
            triggerCount: (state?.triggerCount ?? 0) + 1,
          });

          // Emit event bus event for SSE and dashboard
          eventBus.emit({
            type: 'alert_triggered',
            rule: { id: rule.id, name: rule.name } as any,
            history: { id: 'guardrail', ruleId: rule.id } as any,
            timestamp: now.toISOString(),
          });

          // Log structured entry (NFR-28)
          logger.info('Guardrail triggered', {
            ruleId: rule.id,
            ruleName: rule.name,
            conditionType: rule.conditionType,
            currentValue: result.currentValue,
            threshold: result.threshold,
            triggered: true,
            actionTaken: actionResult,
            dryRun: rule.dryRun,
          });
        }
      } catch (ruleError) {
        // Per-rule error: log and continue to next rule (NFR-10)
        logger.error('GuardrailEngine: rule evaluation failed', {
          ruleId: rule.id, error: ruleError,
        });
      }
    }
  }
}
```

### 3.3 Condition Evaluator Interface

```typescript
// packages/server/src/lib/guardrails/conditions/index.ts

import type {
  GuardrailRule,
  GuardrailConditionResult,
  GuardrailConditionType,
  AgentLensEvent,
} from '@agentlensai/core';
import type { IEventStore } from '@agentlensai/core';

export interface ConditionEvaluator {
  evaluate(
    rule: GuardrailRule,
    event: AgentLensEvent,
    eventStore: IEventStore,
    db: SqliteDb,
  ): GuardrailConditionResult;
}

export function createConditionEvaluator(type: GuardrailConditionType): ConditionEvaluator {
  switch (type) {
    case 'error_rate_threshold': return new ErrorRateEvaluator();
    case 'cost_limit':           return new CostLimitEvaluator();
    case 'health_score_threshold': return new HealthScoreEvaluator();
    case 'custom_metric':        return new CustomMetricEvaluator();
    default:
      throw new Error(`Unknown condition type: ${type}`);
  }
}
```

### 3.4 Condition Evaluators

#### ErrorRateEvaluator

```typescript
// packages/server/src/lib/guardrails/conditions/error-rate.ts

export class ErrorRateEvaluator implements ConditionEvaluator {
  evaluate(rule: GuardrailRule, event: AgentLensEvent, eventStore: IEventStore): GuardrailConditionResult {
    const config = rule.conditionConfig as ErrorRateConditionConfig;
    const windowMs = config.windowMinutes * 60 * 1000;
    const windowStart = new Date(Date.now() - windowMs).toISOString();

    // Query events in the window for this agent (or all agents if global)
    const query: EventQuery = {
      tenantId: event.tenantId,
      from: windowStart,
      limit: 10000, // Cap for performance
    };
    if (rule.agentId) query.agentId = rule.agentId;

    const { events, total } = eventStore.queryEvents(query);
    if (total === 0) {
      return { triggered: false, currentValue: 0, threshold: config.threshold, message: 'No events in window' };
    }

    const errorCount = events.filter(e =>
      e.severity === 'error' || e.severity === 'critical' ||
      e.eventType === 'tool_error'
    ).length;

    const errorRate = (errorCount / total) * 100;

    return {
      triggered: errorRate >= config.threshold,
      currentValue: Math.round(errorRate * 100) / 100,
      threshold: config.threshold,
      message: `Error rate ${errorRate.toFixed(1)}% (${errorCount}/${total} events in ${config.windowMinutes}min window)`,
    };
  }
}
```

#### CostLimitEvaluator

```typescript
// packages/server/src/lib/guardrails/conditions/cost-limit.ts

export class CostLimitEvaluator implements ConditionEvaluator {
  evaluate(rule: GuardrailRule, event: AgentLensEvent, eventStore: IEventStore): GuardrailConditionResult {
    const config = rule.conditionConfig as CostLimitConditionConfig;

    let currentCost: number;
    let scopeLabel: string;

    if (config.scope === 'session') {
      // Cumulative cost for the current session
      const { events } = eventStore.queryEvents({
        tenantId: event.tenantId,
        sessionId: event.sessionId,
        eventType: ['llm_response', 'cost_tracked'],
        limit: 50000,
      });

      currentCost = events.reduce((sum, e) => {
        if (e.eventType === 'llm_response') {
          return sum + ((e.payload as LlmResponsePayload).costUsd || 0);
        }
        if (e.eventType === 'cost_tracked') {
          return sum + ((e.payload as CostTrackedPayload).costUsd || 0);
        }
        return sum;
      }, 0);

      scopeLabel = `session ${event.sessionId}`;

    } else {
      // Daily cost for the agent (UTC day)
      const todayStart = new Date();
      todayStart.setUTCHours(0, 0, 0, 0);

      const agentId = rule.agentId || event.agentId;
      const { events } = eventStore.queryEvents({
        tenantId: event.tenantId,
        agentId,
        eventType: ['llm_response', 'cost_tracked'],
        from: todayStart.toISOString(),
        limit: 50000,
      });

      currentCost = events.reduce((sum, e) => {
        if (e.eventType === 'llm_response') {
          return sum + ((e.payload as LlmResponsePayload).costUsd || 0);
        }
        if (e.eventType === 'cost_tracked') {
          return sum + ((e.payload as CostTrackedPayload).costUsd || 0);
        }
        return sum;
      }, 0);

      scopeLabel = `agent ${agentId} daily`;
    }

    return {
      triggered: currentCost >= config.maxCostUsd,
      currentValue: Math.round(currentCost * 10000) / 10000, // 4 decimal places
      threshold: config.maxCostUsd,
      message: `Cost $${currentCost.toFixed(4)} for ${scopeLabel} (limit: $${config.maxCostUsd})`,
    };
  }
}
```

#### HealthScoreEvaluator

```typescript
// packages/server/src/lib/guardrails/conditions/health-score.ts

export class HealthScoreEvaluator implements ConditionEvaluator {
  evaluate(rule: GuardrailRule, event: AgentLensEvent, eventStore: IEventStore, db: SqliteDb): GuardrailConditionResult {
    const config = rule.conditionConfig as HealthScoreConditionConfig;
    const agentId = rule.agentId || event.agentId;

    // Use existing HealthComputer from v0.6.0
    const computer = new HealthComputer(DEFAULT_HEALTH_WEIGHTS);
    const tenantStore = new TenantScopedStore(eventStore, event.tenantId);
    const healthScore = computer.computeSync(tenantStore, agentId, config.windowDays);

    if (!healthScore) {
      return {
        triggered: false,
        currentValue: 100, // No data = assume healthy
        threshold: config.minScore,
        message: `No health data available for agent ${agentId}`,
      };
    }

    return {
      triggered: healthScore.overallScore < config.minScore,
      currentValue: Math.round(healthScore.overallScore * 100) / 100,
      threshold: config.minScore,
      message: `Health score ${healthScore.overallScore.toFixed(1)} for agent ${agentId} (min: ${config.minScore})`,
    };
  }
}
```

**Performance note:** The HealthScoreEvaluator is the most expensive evaluator. To stay under NFR-1's 50ms target, we:
1. Cache health scores per agent for 60 seconds (in-memory LRU, 100 entries).
2. Only re-evaluate when the triggering event is from the scoped agent.
3. Skip evaluation for event types unlikely to affect health (e.g., `session_started`).

#### CustomMetricEvaluator

```typescript
// packages/server/src/lib/guardrails/conditions/custom-metric.ts

export class CustomMetricEvaluator implements ConditionEvaluator {
  evaluate(rule: GuardrailRule, event: AgentLensEvent): GuardrailConditionResult {
    const config = rule.conditionConfig as CustomMetricConditionConfig;

    // Extract value from event metadata using key path
    const value = this.extractValue(event.metadata, config.metricKeyPath);

    if (value === undefined || value === null || typeof value !== 'number') {
      return {
        triggered: false,
        currentValue: 0,
        threshold: config.value,
        message: `Metric '${config.metricKeyPath}' not found or not numeric in event metadata`,
      };
    }

    const triggered = this.compare(value, config.operator, config.value);

    return {
      triggered,
      currentValue: value,
      threshold: config.value,
      message: `Metric '${config.metricKeyPath}' = ${value} ${config.operator} ${config.value}`,
    };
  }

  private extractValue(metadata: Record<string, unknown>, keyPath: string): unknown {
    const parts = keyPath.split('.');
    let current: unknown = metadata;
    for (const part of parts) {
      if (current == null || typeof current !== 'object') return undefined;
      current = (current as Record<string, unknown>)[part];
    }
    return current;
  }

  private compare(value: number, operator: string, threshold: number): boolean {
    switch (operator) {
      case 'gt':  return value > threshold;
      case 'lt':  return value < threshold;
      case 'gte': return value >= threshold;
      case 'lte': return value <= threshold;
      case 'eq':  return value === threshold;
      default:    return false;
    }
  }
}
```

### 3.5 Evaluation Flow Diagram

```
Event POST /api/events
        │
        ▼
  Store event in SQLite
        │
        ▼
  Return 201 Created  ◀─── User gets response HERE (no guardrail latency)
        │
        ▼ (async, same event loop tick via EventBus)
  eventBus.emit('event_ingested', { event })
        │
        ▼
  GuardrailEngine.onEventIngested()
        │
        ├── Circuit breaker check: disabled? → SKIP
        │
        ▼
  guardrailStore.listEnabledRules(tenantId, agentId)
        │
        ▼ (for each rule)
  ┌─────────────────────────────────────────┐
  │ 1. Check cooldown                        │
  │    lastTriggeredAt + cooldownMinutes > now│
  │    → YES → SKIP this rule                │
  │                                          │
  │ 2. Evaluate condition                    │
  │    → ConditionEvaluator.evaluate(...)    │
  │    → Returns GuardrailConditionResult    │
  │                                          │
  │ 3. Update state (lastEvaluatedAt, value) │
  │                                          │
  │ 4. If triggered:                         │
  │    a. If dryRun → log only, no action    │
  │    b. Else → ActionHandler.execute(...)  │
  │    c. Record trigger history             │
  │    d. Update state (lastTriggeredAt, +1) │
  │    e. Emit bus event for SSE             │
  └─────────────────────────────────────────┘
```

### 3.6 Idempotency (FR-G2.7)

The engine evaluates every `event_ingested` bus event exactly once. If the same event were somehow emitted twice on the bus, the condition evaluators produce the same result (they're stateless computations over the event store), and the cooldown mechanism prevents duplicate action execution within the cooldown window.

For the edge case of server restart during evaluation, trigger history includes the `eventId` in metadata. Consumers can deduplicate by checking for existing trigger records with the same `(ruleId, eventId)` pair.

---

## 4. Action Handlers

### 4.1 Action Handler Interface

```typescript
// packages/server/src/lib/guardrails/actions/index.ts

export interface ActionHandler {
  execute(
    rule: GuardrailRule,
    conditionResult: GuardrailConditionResult,
    event: AgentLensEvent,
  ): void;
}

export function createActionHandler(type: GuardrailActionType): ActionHandler {
  switch (type) {
    case 'pause_agent':      return new PauseAgentHandler();
    case 'notify_webhook':   return new WebhookHandler();
    case 'downgrade_model':  return new ModelDowngradeHandler();
    case 'agentgate_policy': return new AgentGatePolicyHandler();
    default:
      throw new Error(`Unknown action type: ${type}`);
  }
}
```

### 4.2 PauseAgentHandler (FR-G3.1, FR-G3.2)

```typescript
// packages/server/src/lib/guardrails/actions/pause-agent.ts

export class PauseAgentHandler implements ActionHandler {
  execute(rule: GuardrailRule, result: GuardrailConditionResult, event: AgentLensEvent): void {
    const config = rule.actionConfig as PauseAgentActionConfig;
    const agentId = rule.agentId || event.agentId;

    // Set agent paused state in database
    db.run(sql`
      UPDATE agents SET
        paused_at = ${new Date().toISOString()},
        pause_reason = ${config.message || `Guardrail "${rule.name}" triggered: ${result.message}`}
      WHERE id = ${agentId} AND tenant_id = ${event.tenantId}
    `);

    // Emit a guardrail_triggered event into the event stream
    // This uses the existing 'custom' event type to avoid modifying the EventType union
    const guardrailEvent: IngestEventInput = {
      sessionId: event.sessionId,
      agentId,
      eventType: 'custom',
      severity: 'warn',
      payload: {
        type: 'guardrail_triggered',
        data: {
          ruleId: rule.id,
          ruleName: rule.name,
          conditionType: rule.conditionType,
          actionType: rule.actionType,
          conditionValue: result.currentValue,
          threshold: result.threshold,
          message: result.message,
        },
      },
      metadata: { source: 'guardrail_engine' },
    };

    // Ingest as a regular event so it appears in session timeline
    eventStore.ingestEvent(guardrailEvent, event.tenantId);

    logger.info('PauseAgentHandler: agent paused', { agentId, ruleId: rule.id });
  }
}
```

**X-AgentLens-Agent-Paused header (FR-G3.2):** The ingest route checks the agent's `paused_at` field after ingestion and sets the response header:

```typescript
// In ingest route, after storing event:
const agent = agentStore.getAgent(tenantId, event.agentId);
if (agent?.pausedAt) {
  c.header('X-AgentLens-Agent-Paused', 'true');
}
```

### 4.3 WebhookHandler (FR-G3.3, FR-G3.4)

```typescript
// packages/server/src/lib/guardrails/actions/webhook.ts

export class WebhookHandler implements ActionHandler {
  private static readonly MAX_RETRIES = 3;
  private static readonly RETRY_DELAYS = [1000, 2000, 4000]; // Exponential backoff

  execute(rule: GuardrailRule, result: GuardrailConditionResult, event: AgentLensEvent): void {
    const config = rule.actionConfig as WebhookActionConfig;

    const payload: GuardrailWebhookPayload = {
      event: 'guardrail_triggered',
      rule: {
        id: rule.id,
        name: rule.name,
        conditionType: rule.conditionType,
        actionType: rule.actionType,
      },
      condition: {
        currentValue: result.currentValue,
        threshold: result.threshold,
        message: result.message,
      },
      context: {
        agentId: event.agentId,
        sessionId: event.sessionId,
        tenantId: event.tenantId,
      },
      timestamp: new Date().toISOString(),
      dryRun: rule.dryRun,
    };

    // Fire and forget — retry logic runs asynchronously
    this.sendWithRetry(config, payload, 0);
  }

  private async sendWithRetry(
    config: WebhookActionConfig,
    payload: GuardrailWebhookPayload,
    attempt: number,
  ): Promise<void> {
    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'User-Agent': 'AgentLens-Guardrail/0.8.0',
        ...config.headers,
      };

      // Optional HMAC signature
      if (config.secret) {
        const body = JSON.stringify(payload);
        const signature = createHmacSignature(body, config.secret);
        headers['X-AgentLens-Signature'] = signature;
      }

      const response = await fetch(config.url, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(5000), // 5s timeout (NFR-3)
      });

      if (response.ok) {
        logger.info('WebhookHandler: delivered', { url: config.url, ruleId: payload.rule.id });
        return;
      }

      // Retry on 5xx
      if (response.status >= 500 && attempt < WebhookHandler.MAX_RETRIES) {
        await this.retryAfterDelay(config, payload, attempt);
        return;
      }

      logger.warn('WebhookHandler: delivery failed', {
        url: config.url, status: response.status, attempt,
      });
    } catch (error) {
      if (attempt < WebhookHandler.MAX_RETRIES) {
        await this.retryAfterDelay(config, payload, attempt);
        return;
      }
      logger.error('WebhookHandler: delivery failed after retries', {
        url: config.url, error, attempts: attempt + 1,
      });
    }
  }

  private async retryAfterDelay(
    config: WebhookActionConfig,
    payload: GuardrailWebhookPayload,
    attempt: number,
  ): Promise<void> {
    const delay = WebhookHandler.RETRY_DELAYS[attempt] ?? 4000;
    await new Promise(resolve => setTimeout(resolve, delay));
    return this.sendWithRetry(config, payload, attempt + 1);
  }
}
```

### 4.4 ModelDowngradeHandler (FR-G3.5)

```typescript
// packages/server/src/lib/guardrails/actions/model-downgrade.ts

export class ModelDowngradeHandler implements ActionHandler {
  execute(rule: GuardrailRule, result: GuardrailConditionResult, event: AgentLensEvent): void {
    const config = rule.actionConfig as DowngradeModelActionConfig;
    const agentId = rule.agentId || event.agentId;

    // Set modelOverride on the agent record
    db.run(sql`
      UPDATE agents SET
        model_override = ${config.targetModel}
      WHERE id = ${agentId} AND tenant_id = ${event.tenantId}
    `);

    logger.info('ModelDowngradeHandler: model override set', {
      agentId,
      targetModel: config.targetModel,
      ruleId: rule.id,
      reason: result.message,
    });
  }
}
```

### 4.5 AgentGatePolicyHandler (FR-G3.6, FR-G3.7)

```typescript
// packages/server/src/lib/guardrails/actions/agentgate-policy.ts

export class AgentGatePolicyHandler implements ActionHandler {
  execute(rule: GuardrailRule, result: GuardrailConditionResult, event: AgentLensEvent): void {
    const config = rule.actionConfig as AgentGatePolicyActionConfig;

    // AgentGate is optional — check configuration
    if (!config.agentgateUrl) {
      logger.warn('AgentGatePolicyHandler: no agentgateUrl configured, skipping');
      return;
    }

    // Fire and forget
    this.callAgentGate(config, rule, result, event).catch(error => {
      logger.error('AgentGatePolicyHandler: failed to update policy', {
        url: config.agentgateUrl,
        policyId: config.policyId,
        error,
      });
    });
  }

  private async callAgentGate(
    config: AgentGatePolicyActionConfig,
    rule: GuardrailRule,
    result: GuardrailConditionResult,
    event: AgentLensEvent,
  ): Promise<void> {
    const response = await fetch(`${config.agentgateUrl}/api/policies/${config.policyId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: config.action,
        params: config.params,
        triggeredBy: {
          source: 'agentlens_guardrail',
          ruleId: rule.id,
          ruleName: rule.name,
          conditionValue: result.currentValue,
          threshold: result.threshold,
        },
      }),
      signal: AbortSignal.timeout(5000),
    });

    if (!response.ok) {
      throw new Error(`AgentGate API returned ${response.status}`);
    }
  }
}
```

---

## 5. Plugin Architecture

### 5.1 Design Overview

Framework plugins live in the Python SDK under `packages/python-sdk/src/agentlensai/integrations/`. They inherit from the existing `BaseFrameworkPlugin` class and hook into framework-specific lifecycle callbacks.

**Key design decisions:**

1. **Extend BaseFrameworkPlugin, don't replace it.** The base class already handles client resolution, event sending, and fail-safe wrapping. New plugins inherit all of this.

2. **LangChain handler is enhanced, not rewritten.** The existing `AgentLensCallbackHandler` gains new callbacks (chain, agent, retriever) but maintains backward compatibility.

3. **Monkey-patching for CrewAI and AutoGen** (same pattern as existing OpenAI/Anthropic patchers). These frameworks don't have clean callback interfaces, so we patch key methods.

4. **Filter-based for Semantic Kernel.** SK provides a proper filter interface (`FunctionInvocationFilter`). We implement it cleanly.

5. **All plugins are optional pip extras.** Users install only what they need: `pip install agentlensai[langchain]`.

### 5.2 Plugin File Structure

```
packages/python-sdk/src/agentlensai/
├── __init__.py                        # init() extended with auto_detect, plugins, guardrail_enforcement
├── _detection.py                      # NEW: Framework auto-detection
├── _override.py                       # NEW: Model override support
├── _state.py                          # Existing: Global instrumentation state
├── _sender.py                         # Existing: Event sender
├── integrations/
│   ├── __init__.py
│   ├── base.py                        # Existing: BaseFrameworkPlugin
│   ├── openai.py                      # Existing: OpenAI auto-patcher
│   ├── anthropic.py                   # Existing: Anthropic auto-patcher
│   ├── langchain.py                   # ENHANCED: Add chain/agent/retriever callbacks
│   ├── crewai.py                      # NEW: CrewAI plugin
│   ├── autogen.py                     # NEW: AutoGen plugin
│   └── semantic_kernel.py             # NEW: Semantic Kernel plugin
```

### 5.3 Enhanced BaseFrameworkPlugin

Add `_send_llm_call()` and `_send_session_start/end()` helpers to the existing base class:

```python
# Additions to packages/python-sdk/src/agentlensai/integrations/base.py

class BaseFrameworkPlugin:
    # ... existing methods ...

    def _send_llm_call(
        self,
        call_id: str,
        provider: str,
        model: str,
        messages: list[dict],
        system_prompt: str | None,
        completion: str | None,
        tool_calls: list[dict] | None,
        finish_reason: str,
        input_tokens: int,
        output_tokens: int,
        cost_usd: float,
        latency_ms: float,
    ) -> None:
        """Send paired llm_call + llm_response events. NEVER raises."""
        try:
            config = self._get_client_and_config()
            if config is None:
                return
            client, agent_id, session_id, redact = config

            call_event = {
                "sessionId": session_id,
                "agentId": agent_id,
                "eventType": "llm_call",
                "severity": "info",
                "payload": {
                    "callId": call_id,
                    "provider": provider,
                    "model": model,
                    "messages": [] if redact else messages,
                    "systemPrompt": None if redact else system_prompt,
                    "redacted": redact,
                },
                "metadata": {"source": self.framework_name},
                "timestamp": self._now(),
            }

            response_event = {
                "sessionId": session_id,
                "agentId": agent_id,
                "eventType": "llm_response",
                "severity": "info",
                "payload": {
                    "callId": call_id,
                    "provider": provider,
                    "model": model,
                    "completion": None if redact else completion,
                    "toolCalls": tool_calls,
                    "finishReason": finish_reason,
                    "usage": {
                        "inputTokens": input_tokens,
                        "outputTokens": output_tokens,
                        "totalTokens": input_tokens + output_tokens,
                    },
                    "costUsd": cost_usd,
                    "latencyMs": round(latency_ms, 2),
                    "redacted": redact,
                },
                "metadata": {"source": self.framework_name},
                "timestamp": self._now(),
            }

            self._send_event(client, call_event)
            self._send_event(client, response_event)
        except Exception:
            logger.debug("AgentLens %s: failed to send llm_call pair", self.framework_name, exc_info=True)

    def _send_session_event(
        self,
        event_type: str,  # 'session_started' or 'session_ended'
        payload: dict[str, Any],
    ) -> None:
        """Send a session lifecycle event. NEVER raises."""
        try:
            config = self._get_client_and_config()
            if config is None:
                return
            client, agent_id, session_id, _redact = config

            event = {
                "sessionId": session_id,
                "agentId": agent_id,
                "eventType": event_type,
                "severity": "info",
                "payload": payload,
                "metadata": {"source": self.framework_name},
                "timestamp": self._now(),
            }
            self._send_event(client, event)
        except Exception:
            logger.debug("AgentLens %s: failed to send %s", self.framework_name, event_type, exc_info=True)
```

### 5.4 Enhanced LangChain Plugin (FR-F2)

Add chain, agent, and retriever callbacks to the existing handler:

```python
# Additions to packages/python-sdk/src/agentlensai/integrations/langchain.py

class AgentLensCallbackHandler(BaseCallbackHandler):
    """Enhanced LangChain callback handler — adds chain, agent, and retriever support."""

    # ... existing __init__, on_llm_start, on_llm_end, on_tool_start, on_tool_end ...

    # ─── Chain Callbacks (FR-F2.2) ────────────────────

    def on_chain_start(
        self,
        serialized: dict[str, Any],
        inputs: dict[str, Any],
        *,
        run_id: uuid.UUID,
        parent_run_id: uuid.UUID | None = None,
        tags: list[str] | None = None,
        metadata: dict[str, Any] | None = None,
        **kwargs: Any,
    ) -> None:
        """Called when a chain starts. Maps to custom event with chain metadata."""
        try:
            self._run_timers[str(run_id)] = time.perf_counter()

            chain_type = serialized.get("id", ["unknown"])[-1]
            chain_name = serialized.get("kwargs", {}).get("name", chain_type)

            # Detect LangGraph nodes (FR-F2.7)
            is_graph_node = "langgraph" in str(serialized.get("id", [])).lower()

            self._base_send_custom(
                "chain_start",
                {
                    "chain_type": chain_type,
                    "chain_name": chain_name,
                    "run_id": str(run_id),
                    "parent_run_id": str(parent_run_id) if parent_run_id else None,
                    "is_graph_node": is_graph_node,
                    "input_keys": list(inputs.keys()) if isinstance(inputs, dict) else [],
                },
                extra_metadata={"framework_component": "chain"},
            )
        except Exception:
            pass

    def on_chain_end(
        self,
        outputs: dict[str, Any],
        *,
        run_id: uuid.UUID,
        parent_run_id: uuid.UUID | None = None,
        **kwargs: Any,
    ) -> None:
        """Called when a chain ends."""
        try:
            rid = str(run_id)
            start = self._run_timers.pop(rid, None)
            duration_ms = (time.perf_counter() - start) * 1000 if start else 0.0

            self._base_send_custom(
                "chain_end",
                {
                    "run_id": rid,
                    "duration_ms": round(duration_ms, 2),
                    "output_keys": list(outputs.keys()) if isinstance(outputs, dict) else [],
                },
                extra_metadata={"framework_component": "chain"},
            )
        except Exception:
            pass

    def on_chain_error(self, error: BaseException, *, run_id: uuid.UUID, **kwargs: Any) -> None:
        try:
            rid = str(run_id)
            self._run_timers.pop(rid, None)
            self._base_send_custom(
                "chain_error",
                {"run_id": rid, "error": str(error)[:500]},
                severity="error",
                extra_metadata={"framework_component": "chain"},
            )
        except Exception:
            pass

    # ─── Agent Callbacks (FR-F2.6) ────────────────────

    def on_agent_action(self, action: Any, *, run_id: uuid.UUID, **kwargs: Any) -> None:
        try:
            self._base_send_custom(
                "agent_action",
                {
                    "run_id": str(run_id),
                    "tool": getattr(action, "tool", str(action)),
                    "tool_input": str(getattr(action, "tool_input", ""))[:500],
                    "log": str(getattr(action, "log", ""))[:500],
                },
                extra_metadata={"framework_component": "agent"},
            )
        except Exception:
            pass

    def on_agent_finish(self, finish: Any, *, run_id: uuid.UUID, **kwargs: Any) -> None:
        try:
            self._base_send_custom(
                "agent_finish",
                {
                    "run_id": str(run_id),
                    "output": str(getattr(finish, "return_values", ""))[:1000],
                    "log": str(getattr(finish, "log", ""))[:500],
                },
                extra_metadata={"framework_component": "agent"},
            )
        except Exception:
            pass

    # ─── Retriever Callbacks (FR-F2.5) ────────────────

    def on_retriever_start(
        self,
        serialized: dict[str, Any],
        query: str,
        *,
        run_id: uuid.UUID,
        **kwargs: Any,
    ) -> None:
        try:
            self._run_timers[str(run_id)] = time.perf_counter()
            self._base_send_custom(
                "retriever_start",
                {"run_id": str(run_id), "query": query[:500]},
                extra_metadata={"framework_component": "retriever"},
            )
        except Exception:
            pass

    def on_retriever_end(self, documents: list, *, run_id: uuid.UUID, **kwargs: Any) -> None:
        try:
            rid = str(run_id)
            start = self._run_timers.pop(rid, None)
            duration_ms = (time.perf_counter() - start) * 1000 if start else 0.0
            self._base_send_custom(
                "retriever_end",
                {
                    "run_id": rid,
                    "document_count": len(documents),
                    "duration_ms": round(duration_ms, 2),
                    "sources": [getattr(d, "metadata", {}).get("source", "") for d in documents[:10]],
                },
                extra_metadata={"framework_component": "retriever"},
            )
        except Exception:
            pass

    # ─── Internal Helper ──────────────────────────────

    def _base_send_custom(
        self,
        event_subtype: str,
        data: dict,
        severity: str = "info",
        extra_metadata: dict | None = None,
    ) -> None:
        """Send a custom event via the base plugin pattern."""
        config = self._get_client_and_config()
        if config is None:
            return
        client, agent_id, session_id, _redact = config

        metadata = {"source": "langchain"}
        if extra_metadata:
            metadata.update(extra_metadata)

        event = {
            "sessionId": session_id,
            "agentId": agent_id,
            "eventType": "custom",
            "severity": severity,
            "payload": {"type": event_subtype, "data": data},
            "metadata": metadata,
            "timestamp": self._now(),
        }
        self._send_event(client, event)
```

### 5.5 CrewAI Plugin (FR-F3)

CrewAI doesn't expose a clean callback interface. We use monkey-patching on `Crew.kickoff()` and agent/task execution methods:

```python
# packages/python-sdk/src/agentlensai/integrations/crewai.py

"""CrewAI plugin for AgentLens.

Usage:
    pip install agentlensai[crewai]

    import agentlensai
    agentlensai.init(server_url="...", api_key="...", auto_detect=True)
    # CrewAI plugin activates automatically

    # Or explicit:
    from agentlensai.integrations.crewai import AgentLensCrewAIPlugin
    crew = Crew(agents=[...], tasks=[...])
    plugin = AgentLensCrewAIPlugin()
    plugin.instrument_crew(crew)
"""

from __future__ import annotations
import functools
import logging
import time
import uuid
from typing import Any

from agentlensai.integrations.base import BaseFrameworkPlugin

logger = logging.getLogger("agentlensai")

_original_kickoff: Any = None


class AgentLensCrewAIPlugin(BaseFrameworkPlugin):
    """CrewAI lifecycle capture plugin."""

    framework_name = "crewai"

    def __init__(self, **kwargs: Any) -> None:
        super().__init__(**kwargs)
        self._crew_timers: dict[str, float] = {}

    def on_crew_start(self, crew: Any) -> None:
        """FR-F3.1: crew kickoff → session_started"""
        try:
            crew_name = getattr(crew, "name", None) or "unnamed-crew"
            crew_id = str(uuid.uuid4())
            self._crew_timers[crew_id] = time.perf_counter()

            self._send_session_event("session_started", {
                "agentName": crew_name,
                "tags": ["crewai", f"crew:{crew_name}"],
            })

            return crew_id
        except Exception:
            logger.debug("AgentLens crewai: on_crew_start failed", exc_info=True)
            return None

    def on_crew_end(self, crew: Any, crew_id: str | None, result: Any) -> None:
        """FR-F3.1: crew completion → session_ended"""
        try:
            start = self._crew_timers.pop(crew_id or "", None)
            duration_ms = (time.perf_counter() - start) * 1000 if start else 0.0

            self._send_session_event("session_ended", {
                "reason": "completed",
                "summary": str(result)[:500] if result else None,
                "totalDurationMs": round(duration_ms, 2),
            })
        except Exception:
            logger.debug("AgentLens crewai: on_crew_end failed", exc_info=True)

    def on_agent_start(self, agent: Any, task: Any) -> None:
        """FR-F3.2: agent start → custom event with role, goal, backstory"""
        try:
            self._send_custom_event(
                "crewai_agent_start",
                {
                    "agent_role": getattr(agent, "role", "unknown"),
                    "agent_goal": str(getattr(agent, "goal", ""))[:500],
                    "agent_backstory": str(getattr(agent, "backstory", ""))[:300],
                    "task_description": str(getattr(task, "description", ""))[:500],
                },
                extra_metadata={"framework_component": "agent"},
            )
        except Exception:
            logger.debug("AgentLens crewai: on_agent_start failed", exc_info=True)

    def on_task_start(self, task: Any, agent: Any) -> str:
        """FR-F3.3: task start → custom event with task details"""
        try:
            task_id = str(uuid.uuid4())
            self._crew_timers[task_id] = time.perf_counter()

            role = getattr(agent, "role", "unknown")
            self._send_custom_event(
                "crewai_task_start",
                {
                    "task_id": task_id,
                    "description": str(getattr(task, "description", ""))[:500],
                    "expected_output": str(getattr(task, "expected_output", ""))[:300],
                    "assigned_agent": role,
                },
                extra_metadata={"framework_component": "task", "crewai_agent_role": role},
            )
            return task_id
        except Exception:
            logger.debug("AgentLens crewai: on_task_start failed", exc_info=True)
            return str(uuid.uuid4())

    def on_task_end(self, task: Any, agent: Any, task_id: str, output: Any) -> None:
        """FR-F3.3: task end → custom event"""
        try:
            start = self._crew_timers.pop(task_id, None)
            duration_ms = (time.perf_counter() - start) * 1000 if start else 0.0
            role = getattr(agent, "role", "unknown")

            self._send_custom_event(
                "crewai_task_end",
                {
                    "task_id": task_id,
                    "assigned_agent": role,
                    "duration_ms": round(duration_ms, 2),
                    "output": str(output)[:1000] if output else None,
                },
                extra_metadata={"framework_component": "task", "crewai_agent_role": role},
            )
        except Exception:
            logger.debug("AgentLens crewai: on_task_end failed", exc_info=True)

    def on_delegation(self, delegator: Any, delegatee: Any, reason: str) -> None:
        """FR-F3.4: delegation event"""
        try:
            self._send_custom_event(
                "crewai_delegation",
                {
                    "delegator": getattr(delegator, "role", "unknown"),
                    "delegatee": getattr(delegatee, "role", "unknown"),
                    "reason": str(reason)[:500],
                },
                extra_metadata={"framework_component": "delegation"},
            )
        except Exception:
            logger.debug("AgentLens crewai: on_delegation failed", exc_info=True)


# ─── Global Instrumentation ──────────────────────────

def instrument_crewai() -> None:
    """Monkey-patch CrewAI to auto-capture lifecycle events."""
    global _original_kickoff

    try:
        from crewai import Crew
    except ImportError:
        logger.debug("AgentLens: crewai not installed, skipping")
        return

    if _original_kickoff is not None:
        return  # Already instrumented

    _original_kickoff = Crew.kickoff
    plugin = AgentLensCrewAIPlugin()

    @functools.wraps(_original_kickoff)
    def patched_kickoff(self: Any, *args: Any, **kwargs: Any) -> Any:
        crew_id = plugin.on_crew_start(self)
        try:
            result = _original_kickoff(self, *args, **kwargs)
            plugin.on_crew_end(self, crew_id, result)
            return result
        except Exception as e:
            plugin.on_crew_end(self, crew_id, f"Error: {e}")
            raise

    Crew.kickoff = patched_kickoff
    logger.info("AgentLens: CrewAI integration instrumented")


def uninstrument_crewai() -> None:
    global _original_kickoff
    if _original_kickoff is not None:
        from crewai import Crew
        Crew.kickoff = _original_kickoff
        _original_kickoff = None
```

### 5.6 AutoGen Plugin (FR-F4)

```python
# packages/python-sdk/src/agentlensai/integrations/autogen.py

"""AutoGen plugin for AgentLens.

Supports both AutoGen v0.2 (pyautogen) and v0.4+ (autogen-agentchat).
Uses monkey-patching on ConversableAgent.send/receive.
"""

from __future__ import annotations
import functools
import logging
import time
import uuid
from typing import Any

from agentlensai.integrations.base import BaseFrameworkPlugin

logger = logging.getLogger("agentlensai")

_original_send: Any = None
_original_receive: Any = None


class AgentLensAutoGenPlugin(BaseFrameworkPlugin):
    """AutoGen conversation and message capture plugin."""

    framework_name = "autogen"

    def on_message(self, sender: Any, receiver: Any, message: Any, is_send: bool) -> None:
        """FR-F4.2: Capture agent message exchanges."""
        try:
            sender_name = getattr(sender, "name", str(sender))
            receiver_name = getattr(receiver, "name", str(receiver))

            content = ""
            msg_type = "text"
            if isinstance(message, dict):
                content = str(message.get("content", ""))[:1000]
                if "function_call" in message or "tool_calls" in message:
                    msg_type = "function_call"
            elif isinstance(message, str):
                content = message[:1000]

            self._send_custom_event(
                "autogen_message",
                {
                    "sender": sender_name,
                    "receiver": receiver_name,
                    "direction": "send" if is_send else "receive",
                    "message_type": msg_type,
                    "content_preview": content[:200],
                    "content_length": len(content),
                },
                extra_metadata={
                    "framework_component": "message",
                    "autogen_sender": sender_name,
                    "autogen_receiver": receiver_name,
                },
            )
        except Exception:
            logger.debug("AgentLens autogen: on_message failed", exc_info=True)

    def on_conversation_start(self, initiator: Any, recipient: Any) -> None:
        """FR-F4.1: initiate_chat → session_started"""
        try:
            self._send_session_event("session_started", {
                "agentName": getattr(initiator, "name", "autogen-agent"),
                "tags": ["autogen", f"initiator:{getattr(initiator, 'name', 'unknown')}"],
            })
        except Exception:
            logger.debug("AgentLens autogen: on_conversation_start failed", exc_info=True)


def instrument_autogen() -> None:
    """Monkey-patch AutoGen to auto-capture messages."""
    global _original_send, _original_receive

    # Try v0.4+ first, then v0.2
    ConversableAgent = None
    try:
        from autogen_agentchat.agents import ConversableAgent as CA
        ConversableAgent = CA
    except ImportError:
        try:
            from autogen import ConversableAgent as CA
            ConversableAgent = CA
        except ImportError:
            logger.debug("AgentLens: autogen not installed, skipping")
            return

    if _original_send is not None:
        return

    _original_send = ConversableAgent.send
    plugin = AgentLensAutoGenPlugin()

    @functools.wraps(_original_send)
    def patched_send(self: Any, message: Any, recipient: Any, *args: Any, **kwargs: Any) -> Any:
        plugin.on_message(self, recipient, message, is_send=True)
        return _original_send(self, message, recipient, *args, **kwargs)

    ConversableAgent.send = patched_send
    logger.info("AgentLens: AutoGen integration instrumented")


def uninstrument_autogen() -> None:
    global _original_send
    if _original_send is not None:
        try:
            from autogen_agentchat.agents import ConversableAgent
        except ImportError:
            from autogen import ConversableAgent
        ConversableAgent.send = _original_send
        _original_send = None
```

### 5.7 Semantic Kernel Plugin (FR-F5)

```python
# packages/python-sdk/src/agentlensai/integrations/semantic_kernel.py

"""Semantic Kernel plugin for AgentLens.

Uses SK's filter interface for clean, non-intrusive instrumentation.

Usage:
    from agentlensai.integrations.semantic_kernel import AgentLensFilter
    kernel.add_filter("function_invocation", AgentLensFilter())
"""

from __future__ import annotations
import logging
import time
import uuid
from typing import Any

from agentlensai.integrations.base import BaseFrameworkPlugin

logger = logging.getLogger("agentlensai")


class AgentLensFilter(BaseFrameworkPlugin):
    """Semantic Kernel FunctionInvocationFilter implementation.

    FR-F5.1: Implements SK's filter interface for function and AI service calls.
    """

    framework_name = "semantic_kernel"

    def __init__(self, **kwargs: Any) -> None:
        super().__init__(**kwargs)
        self._call_timers: dict[str, float] = {}

    async def on_function_invocation(
        self,
        context: Any,  # FunctionInvocationContext
        next_handler: Any,
    ) -> None:
        """FR-F5.2: Capture function invocations."""
        call_id = str(uuid.uuid4())
        function_name = ""
        plugin_name = ""

        try:
            function_name = getattr(context.function, "name", "unknown")
            plugin_name = getattr(context.function, "plugin_name", "")
            full_name = f"{plugin_name}.{function_name}" if plugin_name else function_name

            self._call_timers[call_id] = time.perf_counter()

            self._send_tool_call(
                tool_name=full_name,
                call_id=call_id,
                arguments=_extract_arguments(context),
            )
        except Exception:
            logger.debug("AgentLens SK: pre-invocation capture failed", exc_info=True)

        # CRITICAL: Always call next handler — never block SK pipeline
        await next_handler(context)

        try:
            start = self._call_timers.pop(call_id, None)
            duration_ms = (time.perf_counter() - start) * 1000 if start else 0.0
            full_name = f"{plugin_name}.{function_name}" if plugin_name else function_name

            if context.exception:
                self._send_tool_error(
                    tool_name=full_name,
                    call_id=call_id,
                    error=str(context.exception)[:500],
                    duration_ms=duration_ms,
                )
            else:
                result = str(context.result)[:1000] if context.result else None
                self._send_tool_response(
                    tool_name=full_name,
                    call_id=call_id,
                    result=result,
                    duration_ms=duration_ms,
                )
        except Exception:
            logger.debug("AgentLens SK: post-invocation capture failed", exc_info=True)


def _extract_arguments(context: Any) -> dict[str, Any]:
    """Extract function arguments from SK context."""
    try:
        args = {}
        if hasattr(context, "arguments") and context.arguments:
            for key, val in context.arguments.items():
                args[key] = str(val)[:200]
        return args
    except Exception:
        return {}


def instrument_semantic_kernel() -> None:
    """Auto-register filter on any new Kernel instance via monkey-patching."""
    try:
        from semantic_kernel import Kernel
    except ImportError:
        logger.debug("AgentLens: semantic_kernel not installed, skipping")
        return

    _original_init = Kernel.__init__

    def patched_init(self: Any, *args: Any, **kwargs: Any) -> None:
        _original_init(self, *args, **kwargs)
        try:
            filt = AgentLensFilter()
            self.add_filter("function_invocation", filt)
            logger.debug("AgentLens: SK filter registered on Kernel instance")
        except Exception:
            logger.debug("AgentLens: failed to register SK filter", exc_info=True)

    Kernel.__init__ = patched_init
    logger.info("AgentLens: Semantic Kernel integration instrumented")


def uninstrument_semantic_kernel() -> None:
    """Restore original Kernel.__init__."""
    try:
        from semantic_kernel import Kernel
        if hasattr(Kernel.__init__, "__wrapped__"):
            Kernel.__init__ = Kernel.__init__.__wrapped__
    except Exception:
        pass
```

### 5.8 Framework Auto-Detection (FR-F6)

```python
# packages/python-sdk/src/agentlensai/_detection.py

"""Framework auto-detection for agentlensai.init().

FR-F6.1: Detects installed frameworks by attempting imports.
FR-F6.2: Non-blocking — skip silently on import failure.
FR-F6.3: Logs detected frameworks at INFO level.
FR-F6.5: Runs once at init() time.
"""

import importlib.util
import logging
from typing import Any

logger = logging.getLogger("agentlensai")


def detect_and_instrument_frameworks(
    auto_detect: bool = True,
    plugins: list[str] | None = None,
) -> list[str]:
    """Detect installed frameworks and activate their plugins.

    Returns list of activated plugin names.
    """
    activated: list[str] = []

    if not auto_detect and not plugins:
        return activated

    # Define available plugins
    framework_specs = {
        "langchain": ("langchain_core", "agentlensai.integrations.langchain", None),
        "crewai": ("crewai", "agentlensai.integrations.crewai", "instrument_crewai"),
        "autogen": (None, "agentlensai.integrations.autogen", "instrument_autogen"),  # Special: try two packages
        "semantic_kernel": ("semantic_kernel", "agentlensai.integrations.semantic_kernel", "instrument_semantic_kernel"),
    }

    # Determine which plugins to activate
    targets = set()
    if auto_detect:
        for name, (check_pkg, _, _) in framework_specs.items():
            if name == "autogen":
                # Try both package names
                if _is_installed("autogen_agentchat") or _is_installed("autogen") or _is_installed("pyautogen"):
                    targets.add(name)
            elif check_pkg and _is_installed(check_pkg):
                targets.add(name)

    if plugins:
        targets.update(plugins)

    # Activate detected plugins
    for name in sorted(targets):
        if name not in framework_specs:
            logger.warning("AgentLens: unknown plugin '%s', skipping", name)
            continue

        _, module_path, instrument_fn = framework_specs[name]

        if name == "langchain":
            # LangChain uses callback handler, not monkey-patching
            # Just verify it's importable
            try:
                importlib.import_module(module_path)
                activated.append(name)
                logger.debug("AgentLens: LangChain callback handler available")
            except ImportError:
                logger.debug("AgentLens: failed to load langchain plugin")
            continue

        try:
            module = importlib.import_module(module_path)
            if instrument_fn:
                getattr(module, instrument_fn)()
            activated.append(name)
        except ImportError:
            logger.debug("AgentLens: failed to load %s plugin (missing dependency)", name)
        except Exception:
            logger.debug("AgentLens: failed to instrument %s", name, exc_info=True)

    if activated:
        # FR-F6.3: Log at INFO
        versions = []
        for name in activated:
            ver = _get_version(name)
            versions.append(f"{name} {ver}" if ver else name)
        logger.info("AgentLens: Detected frameworks: %s. Plugins activated.", ", ".join(versions))

    return activated


def _is_installed(package_name: str) -> bool:
    """Check if a package is installed without importing it."""
    return importlib.util.find_spec(package_name) is not None


def _get_version(framework: str) -> str | None:
    """Best-effort version detection."""
    try:
        import importlib.metadata
        name_map = {
            "langchain": "langchain-core",
            "crewai": "crewai",
            "autogen": "autogen-agentchat",
            "semantic_kernel": "semantic-kernel",
        }
        return importlib.metadata.version(name_map.get(framework, framework))
    except Exception:
        return None
```

### 5.9 Model Override Support (FR-F7)

```python
# packages/python-sdk/src/agentlensai/_override.py

"""Model override support for guardrail-triggered model downgrades.

FR-F7.1-F7.4: When guardrail_enforcement=True and a modelOverride is set on the agent,
the SDK substitutes the model before forwarding to the LLM provider.
"""

import logging
from typing import Any

logger = logging.getLogger("agentlensai")


class ModelOverrideManager:
    """Manages model overrides from guardrail actions."""

    def __init__(self, client: Any, agent_id: str, enabled: bool = False):
        self._client = client
        self._agent_id = agent_id
        self._enabled = enabled
        self._cached_override: str | None = None
        self._last_check: float = 0
        self._check_interval = 30.0  # seconds

    def get_override(self) -> str | None:
        """Get current model override from server, with caching."""
        if not self._enabled:
            return None

        import time
        now = time.time()
        if now - self._last_check < self._check_interval:
            return self._cached_override

        try:
            response = self._client._request("GET", f"/api/agents/{self._agent_id}")
            self._cached_override = response.get("modelOverride")
            self._last_check = now

            if self._cached_override:
                logger.info(
                    "AgentLens guardrail: Model override active → %s (agent: %s)",
                    self._cached_override,
                    self._agent_id,
                )

            return self._cached_override
        except Exception:
            logger.debug("AgentLens: failed to check model override", exc_info=True)
            return self._cached_override  # Return stale cache on error

    def apply_override(self, kwargs: dict[str, Any], original_model: str) -> dict[str, Any]:
        """Apply model override to LLM call kwargs if active."""
        override = self.get_override()
        if override and override != original_model:
            logger.info(
                "AgentLens guardrail: Model downgraded from %s to %s",
                original_model,
                override,
            )
            kwargs["model"] = override
        return kwargs
```

### 5.10 Event Mapping Table

All framework events map to existing AgentLens event types (no new event types needed):

| Framework | Event | AgentLens EventType | Key Metadata |
|-----------|-------|-------------------|--------------|
| **LangChain** | `on_chain_start` | `custom` (type: `chain_start`) | `chain_type`, `chain_name`, `is_graph_node` |
| | `on_chain_end` | `custom` (type: `chain_end`) | `duration_ms`, `output_keys` |
| | `on_chain_error` | `custom` (type: `chain_error`) | `error` |
| | `on_llm_start/end` | `llm_call` + `llm_response` | `source=langchain` |
| | `on_tool_start/end/error` | `tool_call` / `tool_response` / `tool_error` | `source=langchain` |
| | `on_agent_action/finish` | `custom` (type: `agent_action/finish`) | `tool`, `tool_input`, `output` |
| | `on_retriever_start/end` | `custom` (type: `retriever_start/end`) | `query`, `document_count`, `sources` |
| **CrewAI** | crew kickoff | `session_started` | `tags: [crewai, crew:{name}]` |
| | crew completion | `session_ended` | `reason`, `summary` |
| | agent start/end | `custom` (type: `crewai_agent_start/end`) | `agent_role`, `agent_goal`, `agent_backstory` |
| | task start/end | `custom` (type: `crewai_task_start/end`) | `description`, `expected_output`, `assigned_agent` |
| | delegation | `custom` (type: `crewai_delegation`) | `delegator`, `delegatee`, `reason` |
| | tool calls | `tool_call` / `tool_response` / `tool_error` | `source=crewai`, `crewai_agent_role` |
| **AutoGen** | initiate_chat | `session_started` | `tags: [autogen]` |
| | agent message | `custom` (type: `autogen_message`) | `sender`, `receiver`, `direction`, `message_type` |
| | LLM call | `llm_call` / `llm_response` | `source=autogen` |
| | function call | `tool_call` / `tool_response` | `source=autogen` |
| **Semantic Kernel** | function invocation | `tool_call` / `tool_response` / `tool_error` | `source=semantic_kernel`, plugin_name |
| | AI service call | `llm_call` / `llm_response` | `source=semantic_kernel` |

### 5.11 agentId Resolution (FR-F1.8, FR-F3.6)

Each plugin automatically sets `agentId` from framework identifiers:

| Framework | agentId Source | Example |
|-----------|---------------|---------|
| LangChain | Chain name or graph name | `RetrievalQA`, `rag-graph` |
| CrewAI | `{crew_name}/{agent_role}` | `content-crew/researcher` |
| AutoGen | Agent name | `assistant`, `user_proxy` |
| Semantic Kernel | Kernel name or configured ID | `my-kernel`, `rag-agent` |

---

## 6. REST API Design

### 6.1 Guardrail Endpoints

All endpoints require authentication via API key and enforce tenant isolation (NFR-11, NFR-12).

#### Create Guardrail Rule

```
POST /api/guardrails
```

**Request Body** (validated by `CreateGuardrailRuleSchema`):

```json
{
  "name": "Cost Circuit Breaker",
  "description": "Pause agent when session cost exceeds $10",
  "enabled": true,
  "conditionType": "cost_limit",
  "conditionConfig": {
    "maxCostUsd": 10.0,
    "scope": "session"
  },
  "actionType": "pause_agent",
  "actionConfig": {
    "message": "Session cost exceeded $10 limit"
  },
  "agentId": "rag-agent",
  "cooldownMinutes": 15,
  "dryRun": true
}
```

**Response (201):**

```json
{
  "id": "01HXYZ...",
  "tenantId": "tenant-1",
  "name": "Cost Circuit Breaker",
  "enabled": true,
  "conditionType": "cost_limit",
  "conditionConfig": { "maxCostUsd": 10.0, "scope": "session" },
  "actionType": "pause_agent",
  "actionConfig": { "message": "Session cost exceeded $10 limit" },
  "agentId": "rag-agent",
  "cooldownMinutes": 15,
  "dryRun": true,
  "createdAt": "2026-02-08T21:00:00Z",
  "updatedAt": "2026-02-08T21:00:00Z"
}
```

#### List Guardrail Rules

```
GET /api/guardrails?enabled=true&agentId=rag-agent&conditionType=cost_limit&actionType=pause_agent
```

**Response (200):**

```json
{
  "rules": [ /* GuardrailRule[] */ ],
  "total": 5
}
```

#### Get Guardrail Rule Detail

```
GET /api/guardrails/:id
```

**Response (200):**

```json
{
  "rule": { /* GuardrailRule */ },
  "state": {
    "lastTriggeredAt": "2026-02-08T20:30:00Z",
    "triggerCount": 3,
    "lastEvaluatedAt": "2026-02-08T21:00:00Z",
    "currentValue": 8.50,
    "cooldownRemainingSeconds": 420
  }
}
```

#### Update Guardrail Rule

```
PUT /api/guardrails/:id
```

**Request Body** (validated by `UpdateGuardrailRuleSchema` — partial update):

```json
{
  "conditionConfig": { "maxCostUsd": 20.0, "scope": "session" },
  "dryRun": false
}
```

#### Delete Guardrail Rule

```
DELETE /api/guardrails/:id
```

**Response:** `204 No Content`

Deletes rule, state, and trigger history (cascade).

#### Enable/Disable Guardrail Rule

```
PUT /api/guardrails/:id/enable
PUT /api/guardrails/:id/disable
```

**Response (200):**

```json
{ "id": "01HXYZ...", "enabled": true }
```

#### Reset Guardrail State

```
POST /api/guardrails/:id/reset
```

**Response (200):**

```json
{
  "ruleId": "01HXYZ...",
  "state": {
    "lastTriggeredAt": null,
    "triggerCount": 0,
    "lastEvaluatedAt": null,
    "currentValue": null
  }
}
```

#### Get Trigger History

```
GET /api/guardrails/:id/history?limit=20&offset=0
```

**Response (200):**

```json
{
  "triggers": [
    {
      "id": "01HABC...",
      "ruleId": "01HXYZ...",
      "triggeredAt": "2026-02-08T20:30:00Z",
      "conditionValue": 12.50,
      "conditionThreshold": 10.0,
      "actionExecuted": true,
      "actionResult": "success",
      "metadata": {
        "eventId": "01HEVT...",
        "agentId": "rag-agent",
        "sessionId": "sess_abc123"
      }
    }
  ],
  "total": 3,
  "hasMore": false
}
```

#### Unpause Agent

```
PUT /api/agents/:id/unpause
```

Clears `paused_at`, `pause_reason`, and optionally `model_override`:

**Request Body (optional):**

```json
{
  "clearModelOverride": true
}
```

**Response (200):**

```json
{
  "id": "rag-agent",
  "pausedAt": null,
  "pauseReason": null,
  "modelOverride": null
}
```

### 6.2 Route Implementation Pattern

Following the existing pattern (see `health.ts`):

```typescript
// packages/server/src/routes/guardrails.ts

import { Hono } from 'hono';
import type { AuthVariables } from '../middleware/auth.js';
import { CreateGuardrailRuleSchema, UpdateGuardrailRuleSchema } from '@agentlensai/core';
import { GuardrailStore } from '../db/guardrail-store.js';

export function registerGuardrailRoutes(
  app: Hono<{ Variables: AuthVariables }>,
  guardrailStore: GuardrailStore,
): void {

  // POST /api/guardrails
  app.post('/api/guardrails', async (c) => {
    const tenantId = c.get('apiKey')?.tenantId ?? 'default';
    const body = await c.req.json().catch(() => null);
    if (!body) return c.json({ error: 'Invalid JSON' }, 400);

    const parsed = CreateGuardrailRuleSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: parsed.error.issues.map(i => i.message).join('; ') }, 400);
    }

    const rule: GuardrailRule = {
      id: generateUlid(),
      tenantId,
      ...parsed.data,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    guardrailStore.createRule(rule);
    return c.json(rule, 201);
  });

  // GET /api/guardrails
  app.get('/api/guardrails', async (c) => {
    const tenantId = c.get('apiKey')?.tenantId ?? 'default';
    const rules = guardrailStore.listRules(tenantId);

    // Apply query filters
    const enabledFilter = c.req.query('enabled');
    const agentIdFilter = c.req.query('agentId');
    const conditionTypeFilter = c.req.query('conditionType');
    const actionTypeFilter = c.req.query('actionType');

    let filtered = rules;
    if (enabledFilter !== undefined) {
      filtered = filtered.filter(r => r.enabled === (enabledFilter === 'true'));
    }
    if (agentIdFilter) {
      filtered = filtered.filter(r => r.agentId === agentIdFilter || !r.agentId);
    }
    if (conditionTypeFilter) {
      filtered = filtered.filter(r => r.conditionType === conditionTypeFilter);
    }
    if (actionTypeFilter) {
      filtered = filtered.filter(r => r.actionType === actionTypeFilter);
    }

    return c.json({ rules: filtered, total: filtered.length });
  });

  // ... remaining endpoints follow the same pattern ...
}
```

---

## 7. MCP Tool Design

### 7.1 `agentlens_guardrails` Tool (FR-G6)

```typescript
// packages/mcp/src/tools/guardrails.ts

export function registerGuardrailsTool(server: McpServer, transport: AgentLensTransport): void {
  server.tool(
    'agentlens_guardrails',
    `Check and manage guardrail rules that protect agents from runaway behavior.

**When to use:** To check if any guardrails have triggered for the current agent, to see what rules
are active and their current state, or to create/update guardrail rules programmatically.

**Guardrail concepts:**
- **Conditions:** Rules evaluate conditions against live metrics: error rate %, cost thresholds, health score minimums, or custom metrics from event metadata.
- **Actions:** When a condition triggers, an action fires: pause the agent, send a webhook notification, downgrade the model, or update an AgentGate policy.
- **Cooldowns:** After triggering, a rule won't fire again for its cooldown period (default: 15 minutes).
- **Dry-run mode:** New rules default to dry-run — conditions evaluate and log but actions don't execute. Disable dry-run to enforce.

**Actions available:**
- \`list\` — List all guardrail rules with their enabled/disabled status and trigger counts
- \`status\` — Get detailed status for a specific rule: last triggered, cooldown remaining, current metric value
- \`history\` — Get recent trigger events for a specific rule
- \`create\` — Create a new guardrail rule (default: dry-run mode)
- \`update\` — Update an existing guardrail rule
- \`enable\` — Enable a disabled rule
- \`disable\` — Disable a rule without deleting it

**Example:** agentlens_guardrails({ action: "list" }) → shows all rules and their status
**Example:** agentlens_guardrails({ action: "create", name: "Cost Limit", conditionType: "cost_limit", conditionConfig: { maxCostUsd: 10, scope: "session" }, actionType: "pause_agent" })`,
    {
      action: z.enum(['list', 'status', 'history', 'create', 'update', 'enable', 'disable'])
        .describe('Guardrail action to perform'),

      // For status/history/update/enable/disable:
      ruleId: z.string().optional()
        .describe('Guardrail rule ID (required for status, history, update, enable, disable)'),

      // For create/update:
      name: z.string().optional().describe('Rule name (required for create)'),
      description: z.string().optional().describe('Rule description'),
      conditionType: z.string().optional()
        .describe('Condition type: error_rate_threshold, cost_limit, health_score_threshold, custom_metric'),
      conditionConfig: z.record(z.unknown()).optional()
        .describe('Condition configuration (type-specific)'),
      actionType: z.string().optional()
        .describe('Action type: pause_agent, notify_webhook, downgrade_model, agentgate_policy'),
      actionConfig: z.record(z.unknown()).optional()
        .describe('Action configuration (type-specific)'),
      agentId: z.string().optional().describe('Scope to specific agent'),
      cooldownMinutes: z.number().optional().describe('Cooldown period in minutes (default: 15)'),
      dryRun: z.boolean().optional().describe('Dry-run mode (default: true for new rules)'),

      // For history:
      limit: z.number().optional().describe('Max history entries to return (default: 10)'),
    },
    async (params) => {
      try {
        switch (params.action) {
          case 'list': {
            const data = await transport.get('/api/guardrails');
            return { content: [{ type: 'text', text: formatGuardrailList(data.rules) }] };
          }
          case 'status': {
            if (!params.ruleId) return errorResponse('ruleId required for status action');
            const data = await transport.get(`/api/guardrails/${params.ruleId}`);
            return { content: [{ type: 'text', text: formatGuardrailStatus(data) }] };
          }
          case 'history': {
            if (!params.ruleId) return errorResponse('ruleId required for history action');
            const limit = params.limit ?? 10;
            const data = await transport.get(`/api/guardrails/${params.ruleId}/history?limit=${limit}`);
            return { content: [{ type: 'text', text: formatTriggerHistory(data.triggers) }] };
          }
          case 'create': {
            if (!params.name || !params.conditionType || !params.actionType) {
              return errorResponse('name, conditionType, and actionType required for create');
            }
            const data = await transport.post('/api/guardrails', {
              name: params.name,
              description: params.description,
              conditionType: params.conditionType,
              conditionConfig: params.conditionConfig || {},
              actionType: params.actionType,
              actionConfig: params.actionConfig || {},
              agentId: params.agentId,
              cooldownMinutes: params.cooldownMinutes ?? 15,
              dryRun: params.dryRun ?? true, // Default dry-run for safety
            });
            return { content: [{ type: 'text', text: `Guardrail created: ${data.name} (ID: ${data.id}, dry-run: ${data.dryRun})` }] };
          }
          case 'update': {
            if (!params.ruleId) return errorResponse('ruleId required for update');
            const updates: Record<string, unknown> = {};
            if (params.name) updates.name = params.name;
            if (params.description) updates.description = params.description;
            if (params.conditionConfig) updates.conditionConfig = params.conditionConfig;
            if (params.actionConfig) updates.actionConfig = params.actionConfig;
            if (params.cooldownMinutes) updates.cooldownMinutes = params.cooldownMinutes;
            if (params.dryRun !== undefined) updates.dryRun = params.dryRun;
            await transport.put(`/api/guardrails/${params.ruleId}`, updates);
            return { content: [{ type: 'text', text: `Guardrail ${params.ruleId} updated.` }] };
          }
          case 'enable': {
            if (!params.ruleId) return errorResponse('ruleId required for enable');
            await transport.put(`/api/guardrails/${params.ruleId}/enable`, {});
            return { content: [{ type: 'text', text: `Guardrail ${params.ruleId} enabled.` }] };
          }
          case 'disable': {
            if (!params.ruleId) return errorResponse('ruleId required for disable');
            await transport.put(`/api/guardrails/${params.ruleId}/disable`, {});
            return { content: [{ type: 'text', text: `Guardrail ${params.ruleId} disabled.` }] };
          }
        }
      } catch (error) {
        return errorResponse(error instanceof Error ? error.message : 'Unknown error');
      }
    },
  );
}
```

### 7.2 MCP Output Formatting

```typescript
function formatGuardrailList(rules: GuardrailRule[]): string {
  if (rules.length === 0) return 'No guardrail rules configured.';

  const lines = ['Guardrail Rules:', ''];
  for (const rule of rules) {
    const status = rule.enabled ? '✅ Enabled' : '⏸️ Disabled';
    const dryRun = rule.dryRun ? ' (dry-run)' : '';
    const scope = rule.agentId ? ` [agent: ${rule.agentId}]` : ' [all agents]';
    lines.push(`  ${rule.name}${dryRun}`);
    lines.push(`    ${status}${scope}`);
    lines.push(`    Condition: ${rule.conditionType} | Action: ${rule.actionType}`);
    lines.push(`    Cooldown: ${rule.cooldownMinutes}min | ID: ${rule.id}`);
    lines.push('');
  }
  return lines.join('\n');
}

function formatGuardrailStatus(data: { rule: GuardrailRule; state: GuardrailState & { cooldownRemainingSeconds: number } }): string {
  const { rule, state } = data;
  const lines = [
    `Guardrail: ${rule.name}`,
    `Status: ${rule.enabled ? 'Enabled' : 'Disabled'}${rule.dryRun ? ' (dry-run)' : ''}`,
    `Condition: ${rule.conditionType}`,
    `Action: ${rule.actionType}`,
    '',
    'Current State:',
    `  Last triggered: ${state.lastTriggeredAt || 'never'}`,
    `  Trigger count: ${state.triggerCount}`,
    `  Current value: ${state.currentValue ?? 'N/A'}`,
    `  Last evaluated: ${state.lastEvaluatedAt || 'never'}`,
    `  Cooldown remaining: ${state.cooldownRemainingSeconds > 0 ? `${Math.ceil(state.cooldownRemainingSeconds / 60)}min` : 'none'}`,
  ];
  return lines.join('\n');
}

function formatTriggerHistory(triggers: GuardrailTriggerHistory[]): string {
  if (triggers.length === 0) return 'No trigger history.';

  const lines = ['Trigger History:', ''];
  for (const t of triggers) {
    const executed = t.actionExecuted ? '⚡ Executed' : '📋 Logged only';
    lines.push(`  ${t.triggeredAt}`);
    lines.push(`    Value: ${t.conditionValue} (threshold: ${t.conditionThreshold})`);
    lines.push(`    ${executed} — ${t.actionResult || 'N/A'}`);
    lines.push('');
  }
  return lines.join('\n');
}
```

### 7.3 Transport Extensions

```typescript
// Additions to packages/mcp/src/transport.ts

// Guardrail endpoints
async listGuardrails(): Promise<{ rules: GuardrailRule[]; total: number }> {
  return this.get('/api/guardrails');
}

async getGuardrail(id: string): Promise<{ rule: GuardrailRule; state: any }> {
  return this.get(`/api/guardrails/${id}`);
}

async createGuardrail(data: any): Promise<GuardrailRule> {
  return this.post('/api/guardrails', data);
}

async updateGuardrail(id: string, data: any): Promise<GuardrailRule> {
  return this.put(`/api/guardrails/${id}`, data);
}

async getGuardrailHistory(id: string, limit?: number): Promise<{ triggers: GuardrailTriggerHistory[]; total: number }> {
  const qs = limit ? `?limit=${limit}` : '';
  return this.get(`/api/guardrails/${id}/history${qs}`);
}
```

---

## 8. Dashboard Components

### 8.1 Guardrail List Page

**Route:** `/guardrails`

Following the existing dashboard patterns (see `HealthOverview.tsx`):

```
GuardrailListPage
├── PageHeader
│   ├── Title: "Guardrails"
│   ├── Subtitle: "Automated rules that protect your agents"
│   └── "Create Guardrail" button (→ /guardrails/new)
├── SummaryBanner (3-column grid, like HealthOverview)
│   ├── Active Rules count (green)
│   ├── Triggered Today count (yellow)
│   └── Agents Paused count (red)
├── FilterBar
│   ├── StatusFilter: All | Enabled | Disabled
│   ├── ConditionTypeFilter: All | error_rate | cost_limit | health_score | custom
│   └── AgentFilter dropdown
└── GuardrailTable
    └── GuardrailRow × N
        ├── Name + description truncated
        ├── Condition badge (type + summary, e.g., "Cost > $10/session")
        ├── Action badge (type, e.g., "⏸ Pause Agent")
        ├── Status: Enabled/Disabled + dry-run indicator
        ├── Last Triggered (relative time)
        ├── Trigger Count
        └── Actions: View | Enable/Disable toggle | Edit | Delete
```

### 8.2 Guardrail Detail Page

**Route:** `/guardrails/:id`

```
GuardrailDetailPage
├── PageHeader
│   ├── Back button (← Guardrails)
│   ├── Rule name + status badges (enabled/disabled, dry-run)
│   └── Action buttons: Edit | Enable/Disable | Reset State | Delete
├── ConfigurationCard
│   ├── Description
│   ├── Condition section: type, config values, human-readable summary
│   ├── Action section: type, config values
│   ├── Scope: agent-specific or global
│   └── Cooldown period
├── CurrentStateCard
│   ├── Last triggered (absolute + relative)
│   ├── Trigger count (lifetime)
│   ├── Current metric value vs threshold (with progress bar)
│   ├── Last evaluated timestamp
│   └── Cooldown status (remaining time or "ready")
└── TriggerHistoryTimeline
    └── TriggerEntry × N (most recent first)
        ├── Timestamp
        ├── Metric value at trigger
        ├── Threshold
        ├── Action status: executed / dry-run / failed
        ├── Action result
        └── Linked event/session (clickable)
```

### 8.3 Guardrail Create/Edit Form

**Route:** `/guardrails/new` and `/guardrails/:id/edit`

```
GuardrailFormPage
├── PageHeader ("Create Guardrail" or "Edit Guardrail")
├── Form
│   ├── NameInput (required)
│   ├── DescriptionTextarea (optional)
│   ├── ConditionTypeSelect (dropdown: 4 types)
│   │   └── Dynamic ConditionConfigFields (changes based on selected type)
│   │       ├── error_rate_threshold: threshold % input, window minutes input
│   │       ├── cost_limit: max cost USD input, scope radio (session/daily)
│   │       ├── health_score_threshold: min score input, window days input
│   │       └── custom_metric: key path input, operator select, value input, window input
│   ├── ActionTypeSelect (dropdown: 4 types)
│   │   └── Dynamic ActionConfigFields (changes based on selected type)
│   │       ├── pause_agent: optional message textarea
│   │       ├── notify_webhook: URL input, optional headers key-value editor
│   │       ├── downgrade_model: target model input, optional message
│   │       └── agentgate_policy: URL, policy ID, action inputs
│   ├── AgentSelect (optional — "All agents" default + agent dropdown)
│   ├── CooldownInput (number, default 15 minutes)
│   ├── DryRunToggle (default: ON for new rules)
│   ├── EnabledToggle (default: ON)
│   └── Submit button (Create / Save Changes)
└── PreviewCard
    └── Human-readable rule summary: "When [condition] for [agent], [action]"
```

### 8.4 Agent List Page Enhancements (FR-G7.4, FR-G7.5)

Add to existing agent list page:

```
AgentRow (existing)
├── ... existing fields ...
├── PausedBadge (NEW — orange badge: "⏸ Paused by guardrail")
│   └── Tooltip: rule name + pause reason
└── UnpauseButton (NEW — "Resume" button, visible when paused)
    └── Calls PUT /api/agents/:id/unpause
```

### 8.5 Navigation Updates

```typescript
// Add to Layout.tsx sidebar
{ path: '/guardrails', label: 'Guardrails', icon: '🛡️' },  // Under "Monitoring" section
```

### 8.6 API Client Extensions

```typescript
// packages/dashboard/src/api/client.ts

// ─── Guardrails ─────────────────────────────────────

export async function getGuardrails(filters?: {
  enabled?: boolean;
  agentId?: string;
  conditionType?: string;
}): Promise<{ rules: GuardrailRule[]; total: number }> {
  const qs = toQueryString(filters);
  return request(`/api/guardrails${qs}`);
}

export async function getGuardrail(id: string): Promise<{ rule: GuardrailRule; state: any }> {
  return request(`/api/guardrails/${id}`);
}

export async function createGuardrail(data: CreateGuardrailInput): Promise<GuardrailRule> {
  return request('/api/guardrails', { method: 'POST', body: JSON.stringify(data) });
}

export async function updateGuardrail(id: string, data: Partial<GuardrailRule>): Promise<GuardrailRule> {
  return request(`/api/guardrails/${id}`, { method: 'PUT', body: JSON.stringify(data) });
}

export async function deleteGuardrail(id: string): Promise<void> {
  await request(`/api/guardrails/${id}`, { method: 'DELETE' });
}

export async function enableGuardrail(id: string): Promise<void> {
  await request(`/api/guardrails/${id}/enable`, { method: 'PUT' });
}

export async function disableGuardrail(id: string): Promise<void> {
  await request(`/api/guardrails/${id}/disable`, { method: 'PUT' });
}

export async function resetGuardrailState(id: string): Promise<void> {
  await request(`/api/guardrails/${id}/reset`, { method: 'POST' });
}

export async function getGuardrailHistory(
  id: string,
  opts?: { limit?: number; offset?: number },
): Promise<{ triggers: GuardrailTriggerHistory[]; total: number }> {
  const qs = toQueryString(opts);
  return request(`/api/guardrails/${id}/history${qs}`);
}

export async function unpauseAgent(id: string, clearModelOverride?: boolean): Promise<void> {
  await request(`/api/agents/${id}/unpause`, {
    method: 'PUT',
    body: JSON.stringify({ clearModelOverride }),
  });
}
```

---

## 9. Error Handling & Fail-Safety

### 9.1 Guardrail Engine Fail-Safety

The guardrail engine employs defense-in-depth:

```
Level 1: Top-level try/catch in onEventIngested()
         → Catches ANY unhandled error from the entire evaluation pipeline
         → Logs error, increments consecutive failure counter
         → If 10 consecutive failures: DISABLE engine, emit critical log

Level 2: Per-rule try/catch in evaluateEvent()
         → One rule failing doesn't affect other rules
         → Logged as warning, evaluation continues with next rule

Level 3: Action handler isolation
         → Action execution is inside its own try/catch
         → A failed webhook doesn't prevent trigger history recording
         → Action result captures failure message for debugging

Level 4: Event ingestion isolation
         → Guardrail runs AFTER 201 response is sent
         → Even if the engine crashes entirely, events are never lost
```

### 9.2 Plugin Fail-Safety (NFR-7)

Every plugin method follows this pattern:

```python
def on_some_framework_event(self, *args):
    try:
        # All plugin logic here
        config = self._get_client_and_config()
        if config is None:
            return  # Graceful no-op when not initialized

        # ... build and send event ...
    except Exception:
        # NEVER propagate — log and swallow
        logger.debug("AgentLens %s: handler failed", self.framework_name, exc_info=True)
```

**Testing requirement (NFR-20):** Each plugin has dedicated fail-safety tests that:
1. Inject exceptions in the plugin
2. Verify the exception does NOT propagate to the caller
3. Verify the framework operation completes normally despite the plugin failure

### 9.3 Plugin Buffer (NFR-9)

When the AgentLens server is unreachable:

```python
class EventBuffer:
    """Bounded in-memory buffer for events when server is unreachable."""

    MAX_SIZE = 100

    def __init__(self):
        self._buffer: list[dict] = []
        self._server_healthy = True

    def add(self, event: dict) -> None:
        if len(self._buffer) >= self.MAX_SIZE:
            self._buffer.pop(0)  # Drop oldest
            logger.debug("AgentLens: event buffer full, dropping oldest event")
        self._buffer.append(event)

    def flush(self, client: Any) -> int:
        """Try to flush buffered events. Returns count sent."""
        if not self._buffer:
            return 0

        sent = 0
        try:
            client._request("POST", "/api/events", json={"events": self._buffer})
            sent = len(self._buffer)
            self._buffer.clear()
            self._server_healthy = True
        except Exception:
            self._server_healthy = False
        return sent
```

### 9.4 Webhook Fail-Safety

The WebhookHandler never throws from `execute()`. Retries happen asynchronously with exponential backoff. After 3 failed attempts, the failure is logged and recorded in trigger history as `actionResult: "failed: <error>"`. The guardrail itself still records as triggered — only the action delivery failed.

### 9.5 AgentGate Fail-Safety (FR-G3.7)

The AgentGate action is explicitly optional:
- If `agentgateUrl` is not configured → skip with warning log
- If AgentGate API returns error → log failure, trigger still recorded
- If AgentGate is unreachable → timeout after 5s, log failure
- All other guardrail features work independently of AgentGate

---

## 10. Performance Considerations

### 10.1 Guardrail Evaluation Performance (NFR-1, NFR-2)

**Target:** < 50ms per event for condition evaluation.

**Strategy:**

1. **Cooldown check first.** Most rules will be in cooldown most of the time. This check is a single timestamp comparison — effectively free.

2. **Lightweight conditions first.** `custom_metric` just reads event metadata (< 1ms). `cost_limit` queries a bounded result set. `error_rate_threshold` queries a time-windowed result set.

3. **Health score caching.** The `health_score_threshold` evaluator uses an in-memory LRU cache (60s TTL, 100 entries) to avoid recomputing health scores on every event.

4. **Selective evaluation.** Only events from agents with matching rules trigger evaluation. The `listEnabledRules(tenantId, agentId)` query is indexed.

5. **Event count caps.** All event store queries in evaluators have hard `limit` caps (10,000) to prevent unbounded scans.

**Expected latencies:**

| Evaluator | Typical Latency | Worst Case |
|-----------|----------------|------------|
| Cooldown check | < 1ms | < 1ms |
| `custom_metric` | < 1ms | < 2ms |
| `cost_limit` (session) | < 5ms | < 20ms |
| `cost_limit` (daily) | < 10ms | < 30ms |
| `error_rate_threshold` | < 10ms | < 30ms |
| `health_score_threshold` (cached) | < 1ms | < 1ms |
| `health_score_threshold` (uncached) | < 30ms | < 100ms |

### 10.2 Plugin Performance (NFR-4)

**Target:** < 5ms overhead per event.

**Strategy:**

1. **Synchronous metadata extraction.** Building the event payload is pure computation — no I/O.

2. **Fire-and-forget HTTP.** Events are sent asynchronously; the plugin callback returns immediately.

3. **Minimal serialization.** Event payloads are simple dicts. Truncate large strings (prompts, outputs) to 1000 chars.

4. **No blocking on server unavailability.** If the POST fails, it's buffered (up to 100 events) and retried later.

### 10.3 Auto-Detection Performance (NFR-5)

**Target:** < 500ms for `init()` with auto-detection.

`importlib.util.find_spec()` is a filesystem check, not an import. For 4 frameworks, this takes < 10ms total. Actual instrumentation (monkey-patching) adds < 50ms per framework.

### 10.4 Dashboard Performance (NFR-6)

**Target:** < 1s for guardrail list with 100 rules.

The `listRules` query is a simple `SELECT * FROM guardrail_rules WHERE tenant_id = ?`. With the `idx_guardrail_rules_tenant` index, this is < 5ms for 100 rows. State enrichment (cooldown remaining, trigger counts) requires one additional query per rule — use a batch query:

```sql
SELECT * FROM guardrail_state WHERE tenant_id = ? AND rule_id IN (?, ?, ...)
```

This keeps the page load under 50ms server-side.

---

## 11. Database Schema

### 11.1 Existing Tables (Already Migrated)

The following tables were created by the mega-agent in `migrate.ts` and are used as-is:

```sql
-- guardrail_rules: Rule configuration
CREATE TABLE IF NOT EXISTS guardrail_rules (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  condition_type TEXT NOT NULL,
  condition_config TEXT NOT NULL DEFAULT '{}',
  action_type TEXT NOT NULL,
  action_config TEXT NOT NULL DEFAULT '{}',
  agent_id TEXT,
  cooldown_minutes INTEGER NOT NULL DEFAULT 15,
  dry_run INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- guardrail_state: Runtime evaluation state
CREATE TABLE IF NOT EXISTS guardrail_state (
  rule_id TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  last_triggered_at TEXT,
  trigger_count INTEGER NOT NULL DEFAULT 0,
  last_evaluated_at TEXT,
  current_value REAL,
  PRIMARY KEY (rule_id, tenant_id)
);

-- guardrail_trigger_history: Audit log of triggers
CREATE TABLE IF NOT EXISTS guardrail_trigger_history (
  id TEXT PRIMARY KEY,
  rule_id TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  triggered_at TEXT NOT NULL,
  condition_value REAL NOT NULL,
  condition_threshold REAL NOT NULL,
  action_executed INTEGER NOT NULL DEFAULT 0,
  action_result TEXT,
  metadata TEXT NOT NULL DEFAULT '{}'
);
```

### 11.2 New Columns (Added by This Architecture)

Add to the `agents` table for pause and model override support:

```sql
-- In migrate.ts, add PRAGMA check + ALTER:
ALTER TABLE agents ADD COLUMN model_override TEXT;
ALTER TABLE agents ADD COLUMN paused_at TEXT;
ALTER TABLE agents ADD COLUMN pause_reason TEXT;
```

### 11.3 Existing Indexes (Already Created)

```sql
CREATE INDEX IF NOT EXISTS idx_guardrail_rules_tenant ON guardrail_rules(tenant_id);
CREATE INDEX IF NOT EXISTS idx_guardrail_rules_tenant_enabled ON guardrail_rules(tenant_id, enabled);
CREATE INDEX IF NOT EXISTS idx_guardrail_state_tenant ON guardrail_state(tenant_id);
CREATE INDEX IF NOT EXISTS idx_guardrail_trigger_history_tenant ON guardrail_trigger_history(tenant_id);
CREATE INDEX IF NOT EXISTS idx_guardrail_trigger_history_rule ON guardrail_trigger_history(rule_id, triggered_at);
```

### 11.4 New Indexes

```sql
-- For efficient agent pause/override queries
CREATE INDEX IF NOT EXISTS idx_agents_paused ON agents(tenant_id, paused_at)
  WHERE paused_at IS NOT NULL;

-- For efficient trigger history by tenant + time (dashboard queries)
CREATE INDEX IF NOT EXISTS idx_guardrail_trigger_history_tenant_time
  ON guardrail_trigger_history(tenant_id, triggered_at DESC);
```

---

## 12. Testing Strategy

### 12.1 Server Tests (NFR-16: ≥ 90% coverage)

**Unit tests:**

| Component | Tests | Focus |
|-----------|-------|-------|
| `GuardrailEngine` | Engine subscribes to bus, loads rules, dispatches correctly | Orchestration flow |
| `ErrorRateEvaluator` | Boundary values (0%, 50%, 100%), empty window, large event counts | Edge cases |
| `CostLimitEvaluator` | Session vs daily scope, zero cost, multi-currency precision | Aggregation correctness |
| `HealthScoreEvaluator` | Cache hit/miss, no data, below/above threshold | Cache + computation |
| `CustomMetricEvaluator` | Nested key paths, missing keys, all operators | Extraction + comparison |
| `PauseAgentHandler` | Sets paused_at, emits custom event, idempotent | State mutation |
| `WebhookHandler` | Successful delivery, 5xx retry, timeout, max retries | Retry logic |
| `ModelDowngradeHandler` | Sets model_override, correct agent scoping | State mutation |
| `AgentGatePolicyHandler` | API call, timeout, missing URL (skip) | External call + fail-safety |

**Property-based tests (NFR-19):**

```typescript
// Cooldown timing: triggeredAt + cooldownMinutes always gates re-evaluation
test.prop([fc.date(), fc.integer(1, 1440)], (triggeredAt, cooldown) => {
  // Verify cooldown logic is correct regardless of date/cooldown combination
});

// Concurrent evaluation: same event evaluated by two rules never interferes
test.prop([fc.array(fc.record(...))], (rules) => {
  // Verify rules don't share mutable state
});
```

**Integration tests (NFR-17):**

```typescript
// Happy path: create rule, ingest event, verify trigger
// Error cases: invalid rule config, missing required fields, nonexistent rule ID
// Tenant isolation: rule in tenant A invisible to tenant B
// Auth: unauthenticated request returns 401
```

### 12.2 Plugin Tests (NFR-18, NFR-20)

**Per-plugin integration tests:**

```python
# LangChain: Run a RetrievalQA chain with handler, verify events sent
# CrewAI: Run a simple crew, verify crew/agent/task events
# AutoGen: Run a 2-agent conversation, verify message events
# SK: Run a kernel with function, verify tool_call events
```

**Fail-safety tests (NFR-20):**

```python
def test_langchain_plugin_exception_not_propagated():
    """Plugin exception MUST NOT propagate to LangChain."""
    handler = AgentLensCallbackHandler(client=BrokenClient())
    chain = SomeLangChainChain()
    # This MUST NOT raise, even though BrokenClient throws on every call
    result = chain.invoke({"input": "test"}, config={"callbacks": [handler]})
    assert result is not None  # Chain completed successfully
```

### 12.3 End-to-End Tests (NFR-21)

```
Test: Full guardrail loop
  1. Create a cost_limit guardrail rule (dryRun: false)
  2. Ingest events with increasing cost
  3. Verify: trigger history shows correct trigger
  4. Verify: agent is paused in database
  5. Verify: X-AgentLens-Agent-Paused header on next event POST
  6. Unpause agent via API
  7. Verify: agent is no longer paused
```

---

## 13. Migration & Compatibility

### 13.1 Backward Compatibility (NFR-22, NFR-23, NFR-25, NFR-26, NFR-27)

| Compatibility Requirement | How Met |
|--------------------------|---------|
| Existing API endpoints unchanged | Guardrails add new routes only; no modification of existing `/api/events`, `/api/sessions`, etc. |
| Database migrations additive | New columns on `agents` table via `ALTER TABLE ADD COLUMN`. New tables already created by mega-agent. |
| Python SDK backward compatible | `agentlensai.init()` without plugin args behaves identically to v0.7.0. New params are optional. |
| MCP tools follow registration pattern | `agentlens_guardrails` uses the same `McpServer.tool()` pattern as existing 13 tools. |
| Existing core types used as-is | `GuardrailRule`, `GuardrailState`, `GuardrailTriggerHistory`, `GuardrailConditionResult` from `types.ts` — no modifications. |
| Existing Zod schemas used as-is | `CreateGuardrailRuleSchema`, `UpdateGuardrailRuleSchema`, `GuardrailRuleSchema` from `schemas.ts` — no modifications. |
| Existing store used as-is | `GuardrailStore` from `guardrail-store.ts` — CRUD operations already implemented and tested. |

### 13.2 Server Startup Integration

The `GuardrailEngine` is initialised and started in the server's main `startServer()` function:

```typescript
// In packages/server/src/index.ts

import { GuardrailEngine } from './lib/guardrails/engine.js';
import { GuardrailStore } from './db/guardrail-store.js';
import { registerGuardrailRoutes } from './routes/guardrails.js';

// Inside startServer():
const guardrailStore = new GuardrailStore(db);
const guardrailEngine = new GuardrailEngine(guardrailStore, store, db);
guardrailEngine.start();

registerGuardrailRoutes(app, guardrailStore);
```

### 13.3 Python SDK `init()` Extension

```python
# Extended signature for agentlensai.init()

def init(
    server_url: str = "http://localhost:3400",
    api_key: str | None = None,
    agent_id: str = "default",
    session_id: str | None = None,
    tenant_id: str = "default",
    redact: bool = False,
    # v0.8.0 additions:
    auto_detect: bool = True,         # FR-F1.4: Auto-detect frameworks
    plugins: list[str] | None = None, # FR-F6.4: Manual plugin selection
    guardrail_enforcement: bool = False, # FR-F7.4: Opt-in model override
) -> None:
    """Initialise AgentLens instrumentation.

    New in v0.8.0:
    - auto_detect: Automatically detect and instrument installed frameworks
    - plugins: Manually specify plugins to activate (overrides auto_detect)
    - guardrail_enforcement: Enable model override from guardrail actions
    """
    # ... existing initialization ...

    # Framework detection (new)
    from agentlensai._detection import detect_and_instrument_frameworks
    detect_and_instrument_frameworks(auto_detect=auto_detect, plugins=plugins)

    # Model override manager (new)
    if guardrail_enforcement:
        from agentlensai._override import ModelOverrideManager
        state.model_override_manager = ModelOverrideManager(
            client=state.client, agent_id=agent_id, enabled=True
        )
```

### 13.4 pip Extras Configuration

```toml
# In pyproject.toml

[project.optional-dependencies]
langchain = ["langchain-core>=0.2"]
crewai = ["crewai>=0.28"]
autogen = ["autogen-agentchat>=0.4"]
semantic-kernel = ["semantic-kernel>=1.0"]
all = [
    "langchain-core>=0.2",
    "crewai>=0.28",
    "autogen-agentchat>=0.4",
    "semantic-kernel>=1.0",
]
```

---

## Appendix A: PRD Requirement Traceability

### Guardrail Requirements Coverage

| PRD ID | Requirement | Architecture Section |
|--------|------------|---------------------|
| FR-G1.1 | Guardrail rule creation | §2.1 (existing types), §6.1 (REST API) |
| FR-G1.2 | 4 condition types | §2.2 (condition configs), §3.4 (evaluators) |
| FR-G1.3 | 4 action types | §2.3 (action configs), §4 (handlers) |
| FR-G1.4 | Cooldown period | §3.2 (engine cooldown check) |
| FR-G1.5 | Dry-run mode | §3.2 (engine dry-run check), §9.1 (Level 3) |
| FR-G1.6 | Agent scope | §3.2 (listEnabledRules with agentId) |
| FR-G1.7 | Enable/disable | §6.1 (enable/disable endpoints) |
| FR-G2.1 | Async evaluation | §3.5 (flow diagram — after 201) |
| FR-G2.2 | Error rate sliding window | §3.4 (ErrorRateEvaluator) |
| FR-G2.3 | Cost limit session/daily | §3.4 (CostLimitEvaluator) |
| FR-G2.4 | Health score threshold | §3.4 (HealthScoreEvaluator) |
| FR-G2.5 | Custom metric | §3.4 (CustomMetricEvaluator) |
| FR-G2.6 | Cooldown respect | §3.2 (cooldown check first) |
| FR-G2.7 | Idempotency | §3.6 |
| FR-G3.1 | pause_agent action | §4.2 (PauseAgentHandler) |
| FR-G3.2 | X-AgentLens-Agent-Paused header | §4.2 (ingest route check) |
| FR-G3.3 | Webhook POST payload | §2.5 (webhook payload), §4.3 |
| FR-G3.4 | Webhook retry | §4.3 (WebhookHandler retry logic) |
| FR-G3.5 | Model downgrade | §4.4 (ModelDowngradeHandler) |
| FR-G3.6 | AgentGate policy | §4.5 (AgentGatePolicyHandler) |
| FR-G3.7 | AgentGate optional | §4.5 (fail-safe), §9.5 |
| FR-G3.8 | Trigger history logging | §3.2 (engine records triggers) |
| FR-G3.9 | Dry-run logging | §3.2 (actionExecuted: false) |
| FR-G4.1 | State in SQLite | §11.1 (guardrail_state table) |
| FR-G4.2 | Tenant scoping | §11.1 (tenant_id in all tables) |
| FR-G4.3 | Manual state reset | §6.1 (reset endpoint) |
| FR-G4.4 | Manual unpause | §6.1 (unpause endpoint) |
| FR-G5.1-G5.11 | REST endpoints | §6.1 (all 11 endpoints) |
| FR-G6.1-G6.6 | MCP tool | §7.1 (all 7 actions) |
| FR-G7.1-G7.6 | Dashboard | §8.1-8.5 |

### Plugin Requirements Coverage

| PRD ID | Requirement | Architecture Section |
|--------|------------|---------------------|
| FR-F1.1 | BasePlugin inheritance | §5.3 (enhanced BaseFrameworkPlugin) |
| FR-F1.2 | Fail-safe wrapping | §9.2, §5.3 (try/except pattern) |
| FR-F1.3 | init() config | §13.3 |
| FR-F1.4 | Auto-detect | §5.8 (detection module) |
| FR-F1.5 | pip extras | §13.4 |
| FR-F1.6 | Event mapping | §5.10 (mapping table) |
| FR-F1.7 | Framework metadata | §5.10 (metadata column) |
| FR-F1.8 | Auto agentId | §5.11 |
| FR-F2.1-F2.9 | LangChain plugin | §5.4 |
| FR-F3.1-F3.8 | CrewAI plugin | §5.5 |
| FR-F4.1-F4.8 | AutoGen plugin | §5.6 |
| FR-F5.1-F5.9 | Semantic Kernel plugin | §5.7 |
| FR-F6.1-F6.5 | Auto-detection | §5.8 |
| FR-F7.1-F7.5 | Model override | §5.9 |

### NFR Coverage

| NFR | Requirement | Architecture Section |
|-----|------------|---------------------|
| NFR-1 | < 50ms evaluation | §10.1 (latency table) |
| NFR-2 | No POST latency | §3.5 (async after 201) |
| NFR-3 | < 5s webhook | §4.3 (5s timeout) |
| NFR-4 | < 5ms plugin overhead | §10.2 |
| NFR-5 | < 500ms init() | §10.3 |
| NFR-6 | < 1s list page | §10.4 |
| NFR-7 | Plugin fail-safety | §9.2 |
| NFR-8 | Action fail-safety | §9.1 (Level 3), §9.4, §9.5 |
| NFR-9 | Event buffer | §9.3 |
| NFR-10 | Evaluation fail-safety | §9.1 (Level 2) |
| NFR-11 | API auth | §6.1 |
| NFR-12 | Tenant isolation | §6.1, §11.1 |
| NFR-13 | Webhook URL validation | §2.3 (Zod url() validation) |
| NFR-14 | No raw content in webhooks | §2.5 (metadata only) |
| NFR-16-21 | Testing | §12 |
| NFR-22-27 | Compatibility | §13.1 |
| NFR-28-30 | Observability | §3.2 (structured logs), §5.8 (startup logs) |