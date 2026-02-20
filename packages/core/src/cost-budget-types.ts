/**
 * Cost Budget Types (Feature 5 — Story 1)
 *
 * Types for cost budget enforcement and anomaly detection.
 */

export type CostBudgetScope = 'session' | 'agent';
export type CostBudgetPeriod = 'session' | 'daily' | 'weekly' | 'monthly';
export type CostBudgetOnBreach = 'alert' | 'pause_agent' | 'downgrade_model';

export interface CostBudget {
  id: string;
  tenantId: string;
  scope: CostBudgetScope;
  agentId?: string;
  period: CostBudgetPeriod;
  limitUsd: number;
  onBreach: CostBudgetOnBreach;
  downgradeTargetModel?: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CostBudgetState {
  budgetId: string;
  tenantId: string;
  lastBreachAt?: string;
  breachCount: number;
  currentSpend?: number;
  periodStart?: string;
}

export interface CostBudgetStatus {
  budget: CostBudget;
  currentSpend: number;
  limitUsd: number;
  percentUsed: number;
  breached: boolean;
  periodStart: string;
  periodEnd: string;
}

export interface CostAnomalyConfig {
  tenantId: string;
  multiplier: number;
  minSessions: number;
  enabled: boolean;
  updatedAt: string;
}
