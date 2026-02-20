/**
 * Diagnostic Engine (Story 18.7)
 *
 * Orchestrates the full diagnostic flow:
 * cache check → context building → prompt generation → LLM call → parsing → caching
 */

import { createHash } from 'node:crypto';
import type { IEventStore } from '@agentlensai/core';
import type { LLMProvider } from './providers/types.js';
import type { DiagnosticReport } from './types.js';
import { DiagnosticCache } from './cache.js';
import { buildAgentContext, buildSessionContext } from './context-builder.js';
import {
  buildAgentDiagnosticPrompt,
  buildSessionDiagnosticPrompt,
  DIAGNOSTIC_JSON_SCHEMA,
  CORRECTION_PROMPT,
} from './prompt-templates.js';
import { parseLLMResponse } from './response-parser.js';

export class DiagnosticEngine {
  private readonly inflight: Map<string, Promise<DiagnosticReport>>;
  private readonly cacheTtlMs: number;

  constructor(
    private readonly store: IEventStore,
    private readonly llmProvider: LLMProvider | null,
    private readonly cache: DiagnosticCache,
    cacheTtlMs?: number,
    inflight?: Map<string, Promise<DiagnosticReport>>,
  ) {
    this.cacheTtlMs = cacheTtlMs ?? 15 * 60 * 1000;
    this.inflight = inflight ?? new Map();
  }

  async diagnoseAgent(
    agentId: string,
    windowDays: number = 7,
    opts?: { refresh?: boolean },
  ): Promise<DiagnosticReport> {
    const context = await buildAgentContext(this.store, agentId, windowDays);

    const dataHash = DiagnosticCache.hashData({
      health: context.health.overallScore,
      errors: context.errorPatterns.insights.length,
      sessions: context.health.sessionCount,
    });
    const cacheKey = DiagnosticCache.buildKey('agent', agentId, windowDays, dataHash);

    if (!opts?.refresh) {
      const cached = this.cache.get(cacheKey);
      if (cached) return cached;
    }

    // Singleflight: deduplicate concurrent requests for same key
    const existing = this.inflight.get(cacheKey);
    if (existing && !opts?.refresh) return existing;

    const promise = this.runAgentDiagnosis(agentId, windowDays, context, cacheKey);
    this.inflight.set(cacheKey, promise);

    try {
      return await promise;
    } finally {
      this.inflight.delete(cacheKey);
    }
  }

  async diagnoseSession(
    sessionId: string,
    opts?: { refresh?: boolean },
  ): Promise<DiagnosticReport> {
    const context = await buildSessionContext(this.store, sessionId);

    const dataHash = DiagnosticCache.hashData({
      status: context.session.status,
      errors: context.errorEvents.length,
      events: context.timeline.length,
    });
    const cacheKey = DiagnosticCache.buildKey('session', sessionId, 0, dataHash);

    if (!opts?.refresh) {
      const cached = this.cache.get(cacheKey);
      if (cached) return cached;
    }

    const existing = this.inflight.get(cacheKey);
    if (existing && !opts?.refresh) return existing;

    const promise = this.runSessionDiagnosis(sessionId, context, cacheKey);
    this.inflight.set(cacheKey, promise);

    try {
      return await promise;
    } finally {
      this.inflight.delete(cacheKey);
    }
  }

  // ─── Private ───────────────────────────────────────────

  private async runAgentDiagnosis(
    agentId: string,
    windowDays: number,
    context: Awaited<ReturnType<typeof buildAgentContext>>,
    cacheKey: string,
  ): Promise<DiagnosticReport> {
    if (!this.llmProvider) {
      return this.buildFallbackReport('agent', agentId, windowDays, {
        healthScore: context.health.overallScore,
        sessionCount: context.health.sessionCount,
        dataPoints: this.countDataPoints(context),
      });
    }

    const { system, user } = buildAgentDiagnosticPrompt(context);
    const report = await this.callLLMAndParse(
      'agent',
      agentId,
      system,
      user,
      {
        windowDays,
        healthScore: context.health.overallScore,
        sessionCount: context.health.sessionCount,
        dataPoints: this.countDataPoints(context),
      },
    );

    this.cache.set(cacheKey, report);
    return report;
  }

  private async runSessionDiagnosis(
    sessionId: string,
    context: Awaited<ReturnType<typeof buildSessionContext>>,
    cacheKey: string,
  ): Promise<DiagnosticReport> {
    if (!this.llmProvider) {
      return this.buildFallbackReport('session', sessionId, undefined, {
        sessionCount: 1,
        dataPoints: context.timeline.length,
      });
    }

    const { system, user } = buildSessionDiagnosticPrompt(context);
    const report = await this.callLLMAndParse(
      'session',
      sessionId,
      system,
      user,
      {
        sessionCount: 1,
        dataPoints: context.timeline.length,
      },
    );

    this.cache.set(cacheKey, report);
    return report;
  }

  private async callLLMAndParse(
    type: 'agent' | 'session',
    targetId: string,
    system: string,
    user: string,
    meta: { windowDays?: number; healthScore?: number; sessionCount: number; dataPoints: number },
  ): Promise<DiagnosticReport> {
    const provider = this.llmProvider!;

    let attempts = 0;
    let lastError = '';

    while (attempts < 2) {
      try {
        const prompt = attempts === 0 ? user : `${user}\n\n${CORRECTION_PROMPT}`;

        const response = await provider.complete({
          systemPrompt: system,
          userPrompt: prompt,
          jsonSchema: DIAGNOSTIC_JSON_SCHEMA,
          temperature: 0.2,
          maxTokens: 4096,
        });

        const parsed = parseLLMResponse(response.content);
        if (parsed.success) {
          const now = new Date();
          return {
            id: createHash('sha256').update(`${type}:${targetId}:${now.toISOString()}`).digest('hex').slice(0, 16),
            type,
            targetId,
            severity: parsed.data.severity,
            summary: parsed.data.summary,
            rootCauses: parsed.data.rootCauses.map((rc) => ({
              ...rc,
              evidence: rc.evidence.map((e) => ({ ...e, data: {} })),
            })),
            recommendations: parsed.data.recommendations,
            healthScore: meta.healthScore,
            analysisContext: {
              windowDays: meta.windowDays,
              sessionCount: meta.sessionCount,
              dataPoints: meta.dataPoints,
            },
            llmMeta: {
              provider: provider.name,
              model: response.model,
              inputTokens: response.inputTokens,
              outputTokens: response.outputTokens,
              estimatedCostUsd: provider.estimateCost(response.inputTokens, response.outputTokens),
              latencyMs: response.latencyMs,
            },
            createdAt: now.toISOString(),
            expiresAt: new Date(now.getTime() + this.cacheTtlMs).toISOString(),
            source: 'llm',
          };
        }

        lastError = parsed.error;
        attempts++;
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err);
        attempts++;
        if (attempts >= 2) break;
      }
    }

    // All retries exhausted — return fallback
    return this.buildFallbackReport(type, targetId, meta.windowDays, {
      healthScore: meta.healthScore,
      sessionCount: meta.sessionCount,
      dataPoints: meta.dataPoints,
      llmError: lastError,
    });
  }

  private buildFallbackReport(
    type: 'agent' | 'session',
    targetId: string,
    windowDays: number | undefined,
    meta: {
      healthScore?: number;
      sessionCount: number;
      dataPoints: number;
      llmError?: string;
    },
  ): DiagnosticReport {
    const now = new Date();
    const severity: DiagnosticReport['severity'] =
      meta.healthScore !== undefined
        ? meta.healthScore < 40
          ? 'critical'
          : meta.healthScore < 70
            ? 'warning'
            : meta.healthScore < 85
              ? 'info'
              : 'healthy'
        : 'info';

    return {
      id: createHash('sha256').update(`fallback:${type}:${targetId}:${now.toISOString()}`).digest('hex').slice(0, 16),
      type,
      targetId,
      severity,
      summary: 'AI diagnostics unavailable — showing raw analysis data',
      rootCauses: [],
      recommendations: [],
      healthScore: meta.healthScore,
      analysisContext: {
        windowDays,
        sessionCount: meta.sessionCount,
        dataPoints: meta.dataPoints,
      },
      llmMeta: {
        provider: 'none',
        model: 'none',
        inputTokens: 0,
        outputTokens: 0,
        estimatedCostUsd: 0,
        latencyMs: 0,
      },
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + this.cacheTtlMs).toISOString(),
      source: 'fallback',
    };
  }

  private countDataPoints(context: Awaited<ReturnType<typeof buildAgentContext>>): number {
    return (
      context.errorPatterns.insights.length +
      context.toolSequences.insights.length +
      context.costAnalysis.insights.length +
      context.performanceTrends.insights.length
    );
  }
}

// Re-export public API
export { DiagnosticCache } from './cache.js';
export { createLLMProvider, getLLMConfigFromEnv } from './llm-client.js';
export type { DiagnosticReport, DiagnosticRequest } from './types.js';
export type { LLMProvider } from './providers/types.js';
