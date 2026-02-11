/**
 * Guardrail Condition Evaluators (v0.8.0 — Story 1.4)
 *
 * Each condition type has an evaluator that queries the store
 * and returns whether the condition is triggered.
 */

import type { IEventStore, GuardrailRule, GuardrailConditionResult } from '@agentlensai/core';
import { DEFAULT_HEALTH_WEIGHTS } from '@agentlensai/core';
import { HealthComputer } from '../health/computer.js';

export async function evaluateErrorRateThreshold(
  store: IEventStore,
  rule: GuardrailRule,
  agentId: string,
): Promise<GuardrailConditionResult> {
  const config = rule.conditionConfig as { threshold?: number; windowMinutes?: number };
  const threshold = config.threshold ?? 30;
  const windowMinutes = config.windowMinutes ?? 5;

  const now = new Date();
  const from = new Date(now.getTime() - windowMinutes * 60 * 1000).toISOString();

  const to = now.toISOString();
  const counts = await store.countEventsBatch({ agentId, from, to });

  if (counts.total === 0) {
    return { triggered: false, currentValue: 0, threshold, message: 'No events in window' };
  }

  // Architecture §3.4: count error, critical severity AND tool_error event types
  // Deduplicate: tool_error events with error/critical severity are already counted above,
  // but countEventsBatch filters by single field each, so we cap at total
  const totalCount = counts.total;
  const combinedErrors = Math.min(counts.error + counts.critical + counts.toolError, totalCount);
  const errorRate = (combinedErrors / totalCount) * 100;

  return {
    triggered: errorRate >= threshold,
    currentValue: Math.round(errorRate * 100) / 100,
    threshold,
    message: errorRate >= threshold
      ? `Error rate ${errorRate.toFixed(1)}% exceeds threshold ${threshold}%`
      : `Error rate ${errorRate.toFixed(1)}% within threshold ${threshold}%`,
  };
}

export async function evaluateCostLimit(
  store: IEventStore,
  rule: GuardrailRule,
  agentId: string,
  sessionId?: string,
): Promise<GuardrailConditionResult> {
  const config = rule.conditionConfig as { maxCostUsd?: number; scope?: string };
  const maxCostUsd = config.maxCostUsd ?? 10;
  const scope = config.scope ?? 'daily';

  if (scope === 'session' && sessionId) {
    const session = await store.getSession(sessionId);
    const currentCost = session?.totalCostUsd ?? 0;
    return {
      triggered: currentCost >= maxCostUsd,
      currentValue: Math.round(currentCost * 10000) / 10000,
      threshold: maxCostUsd,
      message: currentCost >= maxCostUsd
        ? `Session cost $${currentCost.toFixed(4)} exceeds limit $${maxCostUsd}`
        : `Session cost $${currentCost.toFixed(4)} within limit $${maxCostUsd}`,
    };
  }

  const todayStart = new Date();
  todayStart.setUTCHours(0, 0, 0, 0);
  const dailyCost = await store.sumSessionCost({ agentId, from: todayStart.toISOString() });

  return {
    triggered: dailyCost >= maxCostUsd,
    currentValue: Math.round(dailyCost * 10000) / 10000,
    threshold: maxCostUsd,
    message: dailyCost >= maxCostUsd
      ? `Daily cost $${dailyCost.toFixed(4)} exceeds limit $${maxCostUsd}`
      : `Daily cost $${dailyCost.toFixed(4)} within limit $${maxCostUsd}`,
  };
}

export async function evaluateHealthScoreThreshold(
  store: IEventStore,
  rule: GuardrailRule,
  agentId: string,
): Promise<GuardrailConditionResult> {
  const config = rule.conditionConfig as { minScore?: number; windowDays?: number };
  const minScore = config.minScore ?? 50;
  const windowDays = config.windowDays ?? 7;

  try {
    const computer = new HealthComputer(DEFAULT_HEALTH_WEIGHTS);
    const score = await computer.compute(store, agentId, windowDays);
    if (!score) {
      return { triggered: false, currentValue: 0, threshold: minScore, message: 'No sessions found for health computation' };
    }
    return {
      triggered: score.overallScore < minScore,
      currentValue: Math.round(score.overallScore * 100) / 100,
      threshold: minScore,
      message: score.overallScore < minScore
        ? `Health score ${score.overallScore.toFixed(0)} below minimum ${minScore}`
        : `Health score ${score.overallScore.toFixed(0)} above minimum ${minScore}`,
    };
  } catch {
    return { triggered: false, currentValue: 0, threshold: minScore, message: 'Failed to compute health score' };
  }
}

/**
 * Extract a value from a nested object using dot-notation key path.
 * e.g. getByKeyPath({ a: { b: 3 } }, 'a.b') → 3
 */
function getByKeyPath(obj: Record<string, unknown>, keyPath: string): unknown {
  const parts = keyPath.split('.');
  let current: unknown = obj;
  for (const part of parts) {
    if (current == null || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

function compareMetric(currentValue: number, operator: string, targetValue: number): boolean {
  switch (operator) {
    case 'gt': return currentValue > targetValue;
    case 'gte': return currentValue >= targetValue;
    case 'lt': return currentValue < targetValue;
    case 'lte': return currentValue <= targetValue;
    case 'eq': return currentValue === targetValue;
    default: return false;
  }
}

export async function evaluateCustomMetric(
  store: IEventStore,
  rule: GuardrailRule,
  agentId: string,
): Promise<GuardrailConditionResult> {
  const config = rule.conditionConfig as {
    metricKeyPath?: string;
    // Legacy compat: metricName still supported as fallback
    metricName?: string;
    operator?: string;
    value?: number;
    windowMinutes?: number;
  };
  const metricKeyPath = config.metricKeyPath;
  const operator = config.operator ?? 'gt';
  const targetValue = config.value ?? 0;
  const windowMinutes = config.windowMinutes ?? 60;

  const now = new Date();
  const from = new Date(now.getTime() - windowMinutes * 60 * 1000).toISOString();

  // Architecture §3.4: Use metricKeyPath to extract values from event metadata
  if (metricKeyPath) {
    const eventsResult = await store.queryEvents({ agentId, from, to: now.toISOString(), limit: 1 });
    const values: number[] = [];
    for (const event of eventsResult.events) {
      const md = (event.metadata ?? {}) as Record<string, unknown>;
      const raw = getByKeyPath(md, metricKeyPath);
      if (typeof raw === 'number') values.push(raw);
    }
    // (events returned newest-first by default query order)

    if (values.length === 0) {
      return {
        triggered: false,
        currentValue: 0,
        threshold: targetValue,
        message: `No events with metadata key "${metricKeyPath}" in window`,
      };
    }

    // Use the latest value for comparison (events are returned newest-first, so first element is latest)
    const currentValue = values[0];
    const triggered = compareMetric(currentValue, operator, targetValue);

    return {
      triggered,
      currentValue,
      threshold: targetValue,
      message: triggered
        ? `${metricKeyPath} (${currentValue}) ${operator} ${targetValue} = triggered`
        : `${metricKeyPath} (${currentValue}) ${operator} ${targetValue} = not triggered`,
    };
  }

  // Legacy fallback: metricName-based evaluation for backward compatibility
  const metricName = config.metricName ?? 'event_count';
  let currentValue = 0;
  switch (metricName) {
    case 'event_count':
      currentValue = await store.countEvents({ agentId, from, to: now.toISOString() });
      break;
    case 'error_count':
      currentValue = await store.countEvents({ agentId, from, to: now.toISOString(), severity: 'error' });
      break;
    case 'session_count': {
      const { total } = await store.querySessions({ agentId, from });
      currentValue = total;
      break;
    }
    default:
      return { triggered: false, currentValue: 0, threshold: targetValue, message: `Unknown metric: ${metricName}` };
  }

  const triggered = compareMetric(currentValue, operator, targetValue);

  return {
    triggered,
    currentValue,
    threshold: targetValue,
    message: triggered
      ? `${metricName} (${currentValue}) ${operator} ${targetValue} = triggered`
      : `${metricName} (${currentValue}) ${operator} ${targetValue} = not triggered`,
  };
}

export async function evaluateCondition(
  store: IEventStore,
  rule: GuardrailRule,
  agentId: string,
  sessionId?: string,
): Promise<GuardrailConditionResult> {
  switch (rule.conditionType) {
    case 'error_rate_threshold': return evaluateErrorRateThreshold(store, rule, agentId);
    case 'cost_limit': return evaluateCostLimit(store, rule, agentId, sessionId);
    case 'health_score_threshold': return evaluateHealthScoreThreshold(store, rule, agentId);
    case 'custom_metric': return evaluateCustomMetric(store, rule, agentId);
    default: return { triggered: false, currentValue: 0, threshold: 0, message: `Unknown condition type: ${rule.conditionType}` };
  }
}
