/**
 * Guardrail methods — extracted from client.ts (cq-003)
 */

import type { GuardrailRule } from '@agentlensai/core';
import { AnalyticsMethods } from './analytics.js';
import type {
  CreateGuardrailRuleParams,
  UpdateGuardrailRuleParams,
  GuardrailRuleListResult,
  GuardrailStatusResult,
  GuardrailTriggerHistoryResult,
} from './types.js';

export abstract class GuardrailMethods extends AnalyticsMethods {
  /**
   * List all guardrail rules, optionally filtered by agent.
   */
  async listGuardrails(options?: { agentId?: string }): Promise<GuardrailRuleListResult> {
    const params = new URLSearchParams();
    if (options?.agentId) params.set('agentId', options.agentId);
    const qs = params.toString();
    return this.request<GuardrailRuleListResult>(
      `/api/guardrails${qs ? `?${qs}` : ''}`,
    );
  }

  /**
   * Get a single guardrail rule by ID.
   */
  async getGuardrail(id: string): Promise<GuardrailRule> {
    return this.request<GuardrailRule>(`/api/guardrails/${encodeURIComponent(id)}`);
  }

  /**
   * Create a new guardrail rule.
   */
  async createGuardrail(params: CreateGuardrailRuleParams): Promise<GuardrailRule> {
    return this.request<GuardrailRule>('/api/guardrails', {
      method: 'POST',
      body: params,
    });
  }

  /**
   * Update a guardrail rule.
   */
  async updateGuardrail(id: string, updates: UpdateGuardrailRuleParams): Promise<GuardrailRule> {
    return this.request<GuardrailRule>(`/api/guardrails/${encodeURIComponent(id)}`, {
      method: 'PUT',
      body: updates,
    });
  }

  /**
   * Delete a guardrail rule.
   */
  async deleteGuardrail(id: string): Promise<{ ok: boolean }> {
    return this.request<{ ok: boolean }>(
      `/api/guardrails/${encodeURIComponent(id)}`,
      { method: 'DELETE' },
    );
  }

  /**
   * Enable a guardrail rule.
   */
  async enableGuardrail(id: string): Promise<GuardrailRule> {
    return this.updateGuardrail(id, { enabled: true });
  }

  /**
   * Disable a guardrail rule.
   */
  async disableGuardrail(id: string): Promise<GuardrailRule> {
    return this.updateGuardrail(id, { enabled: false });
  }

  /**
   * Get trigger history for guardrail rules.
   */
  async getGuardrailHistory(options?: {
    ruleId?: string;
    limit?: number;
    offset?: number;
  }): Promise<GuardrailTriggerHistoryResult> {
    const params = new URLSearchParams();
    if (options?.ruleId) params.set('ruleId', options.ruleId);
    if (options?.limit != null) params.set('limit', String(options.limit));
    if (options?.offset != null) params.set('offset', String(options.offset));
    const qs = params.toString();
    return this.request<GuardrailTriggerHistoryResult>(
      `/api/guardrails/history${qs ? `?${qs}` : ''}`,
    );
  }

  /**
   * Get status + recent triggers for a guardrail rule.
   */
  async getGuardrailStatus(id: string): Promise<GuardrailStatusResult> {
    return this.request<GuardrailStatusResult>(
      `/api/guardrails/${encodeURIComponent(id)}/status`,
    );
  }
}
