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

  const totalCount = await store.countEvents({ agentId, from, to: now.toISOString() });

  if (totalCount === 0) {
    return { triggered: false, currentValue: 0, threshold, message: 'No events in window' };
  }

  const errorCount = await store.countEvents({ agentId, from, to: now.toISOString(), severity: 'error' });
  const errorRate = (errorCount / totalCount) * 100;

  return {
    triggered: errorRate > threshold,
    currentValue: Math.round(errorRate * 100) / 100,
    threshold,
    message: errorRate > threshold
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
      triggered: currentCost > maxCostUsd,
      currentValue: Math.round(currentCost * 10000) / 10000,
      threshold: maxCostUsd,
      message: currentCost > maxCostUsd
        ? `Session cost $${currentCost.toFixed(4)} exceeds limit $${maxCostUsd}`
        : `Session cost $${currentCost.toFixed(4)} within limit $${maxCostUsd}`,
    };
  }

  const todayStart = new Date();
  todayStart.setUTCHours(0, 0, 0, 0);
  const { sessions } = await store.querySessions({ agentId, from: todayStart.toISOString(), limit: 10000 });
  const dailyCost = sessions.reduce((sum, s) => sum + (s.totalCostUsd || 0), 0);

  return {
    triggered: dailyCost > maxCostUsd,
    currentValue: Math.round(dailyCost * 10000) / 10000,
    threshold: maxCostUsd,
    message: dailyCost > maxCostUsd
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

export async function evaluateCustomMetric(
  store: IEventStore,
  rule: GuardrailRule,
  agentId: string,
): Promise<GuardrailConditionResult> {
  const config = rule.conditionConfig as { metricName?: string; operator?: string; value?: number; windowMinutes?: number };
  const metricName = config.metricName ?? 'event_count';
  const operator = config.operator ?? 'gt';
  const targetValue = config.value ?? 0;
  const windowMinutes = config.windowMinutes ?? 60;

  const now = new Date();
  const from = new Date(now.getTime() - windowMinutes * 60 * 1000).toISOString();

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

  let triggered = false;
  switch (operator) {
    case 'gt': triggered = currentValue > targetValue; break;
    case 'lt': triggered = currentValue < targetValue; break;
    case 'eq': triggered = currentValue === targetValue; break;
  }

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
