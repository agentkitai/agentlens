/**
 * Cost Budget API Client (Feature 5 — Story 6)
 */

import { request, toQueryString } from './core';

// ─── Types ──────────────────────────────────────────────────

export type CostBudgetScope = 'session' | 'agent';
export type CostBudgetPeriod = 'session' | 'daily' | 'weekly' | 'monthly';
export type CostBudgetOnBreach = 'alert' | 'pause_agent' | 'downgrade_model';

export interface CostBudgetData {
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

export interface CostBudgetStatusData {
  budget: CostBudgetData;
  currentSpend: number;
  limitUsd: number;
  percentUsed: number;
  breached: boolean;
  periodStart: string;
  periodEnd: string;
}

export interface CreateCostBudgetData {
  scope: CostBudgetScope;
  agentId?: string;
  period: CostBudgetPeriod;
  limitUsd: number;
  onBreach?: CostBudgetOnBreach;
  downgradeTargetModel?: string;
  enabled?: boolean;
}

export interface CostAnomalyConfigData {
  tenantId: string;
  multiplier: number;
  minSessions: number;
  enabled: boolean;
  updatedAt: string;
}

// ─── API Functions ──────────────────────────────────────────

export async function listBudgets(params?: {
  agentId?: string;
  scope?: string;
  enabled?: boolean;
}): Promise<{ budgets: CostBudgetData[] }> {
  const qs = toQueryString({
    agentId: params?.agentId,
    scope: params?.scope,
    enabled: params?.enabled,
  });
  return request<{ budgets: CostBudgetData[] }>(`/api/cost-budgets${qs}`);
}

export async function createBudget(data: CreateCostBudgetData): Promise<CostBudgetData> {
  return request<CostBudgetData>('/api/cost-budgets', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function updateBudget(id: string, data: Partial<CreateCostBudgetData>): Promise<CostBudgetData> {
  return request<CostBudgetData>(`/api/cost-budgets/${encodeURIComponent(id)}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  });
}

export async function deleteBudget(id: string): Promise<{ id: string; deleted: boolean }> {
  return request<{ id: string; deleted: boolean }>(`/api/cost-budgets/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
}

export async function getBudgetStatus(id: string): Promise<CostBudgetStatusData> {
  return request<CostBudgetStatusData>(`/api/cost-budgets/${encodeURIComponent(id)}/status`);
}

export async function getAnomalyConfig(): Promise<CostAnomalyConfigData> {
  return request<CostAnomalyConfigData>('/api/cost-anomaly/config');
}

export async function updateAnomalyConfig(data: {
  multiplier?: number;
  minSessions?: number;
  enabled?: boolean;
}): Promise<CostAnomalyConfigData> {
  return request<CostAnomalyConfigData>('/api/cost-anomaly/config', {
    method: 'PUT',
    body: JSON.stringify(data),
  });
}
