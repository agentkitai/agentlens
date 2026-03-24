/**
 * Autonomous Optimization Advisor (Feature 10)
 *
 * Analyzes recent sessions for a given agent and produces actionable
 * optimization suggestions across three dimensions:
 *
 * 1. Model downgrade opportunities — expensive model used for simple tasks
 * 2. Prompt optimization — repeated patterns that could be cached
 * 3. Tool usage improvements — unused tools, redundant tool calls
 */

import type {
  IEventStore,
  AgentLensEvent,
  LlmCallPayload,
  LlmResponsePayload,
} from '@agentlensai/core';
import { lookupModelCost, DEFAULT_MODEL_COSTS } from '@agentlensai/core';
import { classifyCallComplexity } from '../lib/optimization/classifier.js';

// ─── Types ────────────────────────────────────────────

export type SuggestionType = 'model_downgrade' | 'prompt_optimization' | 'tool_usage';

export interface OptimizationSuggestion {
  type: SuggestionType;
  description: string;
  estimatedSavings: number;
  confidence: 'low' | 'medium' | 'high';
  metadata?: Record<string, unknown>;
}

export interface AdvisorResult {
  agentId: string;
  suggestions: OptimizationSuggestion[];
  analyzedSessions: number;
  totalEstimatedSavings: number;
}

// ─── Constants ────────────────────────────────────────

const ANALYSIS_PERIOD_DAYS = 14;
const MAX_EVENTS = 5_000;
const SIMPLE_TIER_EXPENSIVE_MODELS = [
  'claude-opus-4-6', 'claude-opus-4', 'gpt-4o', 'gpt-4.1',
];
const SYSTEM_PROMPT_TOKEN_THRESHOLD = 4000;
const TOOL_REDUNDANCY_THRESHOLD = 0.5; // >50% consecutive duplicate tool calls

// ─── Service ──────────────────────────────────────────

/**
 * Analyze recent sessions for a given agent and return optimization suggestions.
 */
export async function getOptimizationSuggestions(
  store: IEventStore,
  agentId: string,
): Promise<AdvisorResult> {
  const now = new Date();
  const from = new Date(now.getTime() - ANALYSIS_PERIOD_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const to = now.toISOString();

  // Fetch events
  const [callResult, responseResult, toolResult] = await Promise.all([
    store.queryEvents({ eventType: 'llm_call', agentId, from, to, limit: MAX_EVENTS, order: 'asc' }),
    store.queryEvents({ eventType: 'llm_response', agentId, from, to, limit: MAX_EVENTS, order: 'asc' }),
    store.queryEvents({ eventType: 'tool_call', agentId, from, to, limit: MAX_EVENTS, order: 'asc' }),
  ]);

  const callEvents = callResult.events;
  const responseEvents = responseResult.events;
  const toolEvents = toolResult.events;

  // Build response lookup
  const responseMap = new Map<string, AgentLensEvent>();
  for (const evt of responseEvents) {
    const payload = evt.payload as Partial<LlmResponsePayload>;
    if (payload.callId) {
      responseMap.set(payload.callId, evt);
    }
  }

  // Count unique sessions
  const sessionIds = new Set<string>();
  for (const evt of callEvents) {
    if (evt.sessionId) sessionIds.add(evt.sessionId);
  }
  for (const evt of toolEvents) {
    if (evt.sessionId) sessionIds.add(evt.sessionId);
  }

  const suggestions: OptimizationSuggestion[] = [];

  // ── 1. Model downgrade opportunities ──────────────────
  analyzeModelDowngrades(callEvents, responseMap, suggestions);

  // ── 2. Prompt optimization ────────────────────────────
  analyzePromptOptimization(callEvents, responseMap, suggestions);

  // ── 3. Tool usage improvements ────────────────────────
  analyzeToolUsage(toolEvents, suggestions);

  const totalEstimatedSavings = suggestions.reduce((sum, s) => sum + s.estimatedSavings, 0);

  return {
    agentId,
    suggestions,
    analyzedSessions: sessionIds.size,
    totalEstimatedSavings: Math.round(totalEstimatedSavings * 1_000_000) / 1_000_000,
  };
}

/**
 * Aggregate suggestions across all agents.
 */
export async function getOptimizationSummary(
  store: IEventStore,
): Promise<{ agents: AdvisorResult[]; totalEstimatedSavings: number }> {
  const now = new Date();
  const from = new Date(now.getTime() - ANALYSIS_PERIOD_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const to = now.toISOString();

  // Get all recent agent IDs
  const callResult = await store.queryEvents({
    eventType: 'llm_call',
    from,
    to,
    limit: MAX_EVENTS,
    order: 'asc',
  });

  const agentIds = new Set<string>();
  for (const evt of callResult.events) {
    if (evt.agentId) agentIds.add(evt.agentId);
  }

  const agents: AdvisorResult[] = [];
  for (const agentId of agentIds) {
    const result = await getOptimizationSuggestions(store, agentId);
    if (result.suggestions.length > 0) {
      agents.push(result);
    }
  }

  const totalEstimatedSavings = agents.reduce((sum, a) => sum + a.totalEstimatedSavings, 0);

  return {
    agents,
    totalEstimatedSavings: Math.round(totalEstimatedSavings * 1_000_000) / 1_000_000,
  };
}

// ─── Internal Analyzers ──────────────────────────────

function analyzeModelDowngrades(
  callEvents: AgentLensEvent[],
  responseMap: Map<string, AgentLensEvent>,
  suggestions: OptimizationSuggestion[],
): void {
  // Count expensive model usage at simple/moderate tiers
  const modelTierCounts = new Map<string, { count: number; totalCost: number }>();

  for (const callEvent of callEvents) {
    const callPayload = callEvent.payload as Partial<LlmCallPayload>;
    const model = callPayload.model;
    if (!model) continue;

    const responseEvent = callPayload.callId ? responseMap.get(callPayload.callId) : undefined;
    if (!responseEvent) continue;

    const { tier } = classifyCallComplexity(callEvent, responseEvent);

    if ((tier === 'simple' || tier === 'moderate') && SIMPLE_TIER_EXPENSIVE_MODELS.includes(model)) {
      const key = `${model}::${tier}`;
      const existing = modelTierCounts.get(key) ?? { count: 0, totalCost: 0 };
      const respPayload = responseEvent.payload as Partial<LlmResponsePayload>;
      existing.count++;
      existing.totalCost += respPayload.costUsd ?? 0;
      modelTierCounts.set(key, existing);
    }
  }

  for (const [key, stats] of modelTierCounts) {
    if (stats.count < 5) continue;

    const [model, tier] = key.split('::');
    const estimatedSavings = stats.totalCost * 0.6; // ~60% savings from downgrade

    suggestions.push({
      type: 'model_downgrade',
      description: `${model} used ${stats.count} times for ${tier} tasks. Consider a cheaper model (e.g., sonnet/haiku) for these calls.`,
      estimatedSavings: Math.round(estimatedSavings * 1_000_000) / 1_000_000,
      confidence: stats.count > 50 ? 'high' : stats.count > 20 ? 'medium' : 'low',
      metadata: { model, tier, callCount: stats.count, currentCost: stats.totalCost },
    });
  }
}

function analyzePromptOptimization(
  callEvents: AgentLensEvent[],
  responseMap: Map<string, AgentLensEvent>,
  suggestions: OptimizationSuggestion[],
): void {
  // Detect oversized system prompts
  const largeSystemPrompts = new Map<string, { count: number; avgTokens: number; totalInputCost: number }>();

  for (const callEvent of callEvents) {
    const callPayload = callEvent.payload as Partial<LlmCallPayload>;
    const model = callPayload.model ?? 'unknown';
    const messages = (callPayload as any).messages as Array<{ role: string; content: string }> | undefined;

    if (!messages) continue;

    const systemMsg = messages.find((m) => m.role === 'system');
    if (!systemMsg?.content) continue;

    // Rough token estimation: chars / 4
    const estimatedTokens = Math.ceil(systemMsg.content.length / 4);
    if (estimatedTokens > SYSTEM_PROMPT_TOKEN_THRESHOLD) {
      const existing = largeSystemPrompts.get(model) ?? { count: 0, avgTokens: 0, totalInputCost: 0 };
      existing.avgTokens = (existing.avgTokens * existing.count + estimatedTokens) / (existing.count + 1);
      existing.count++;

      // Estimate input cost for these tokens
      const costInfo = lookupModelCost(model, DEFAULT_MODEL_COSTS);
      if (costInfo) {
        existing.totalInputCost += (estimatedTokens / 1_000_000) * costInfo.input;
      }

      largeSystemPrompts.set(model, existing);
    }
  }

  for (const [model, stats] of largeSystemPrompts) {
    if (stats.count < 3) continue;

    // Caching could save ~80% of repeated system prompt costs
    const estimatedSavings = stats.totalInputCost * 0.8;

    suggestions.push({
      type: 'prompt_optimization',
      description: `${stats.count} calls to ${model} have system prompts averaging ${Math.round(stats.avgTokens)} tokens. Consider prompt caching or shortening the system prompt.`,
      estimatedSavings: Math.round(estimatedSavings * 1_000_000) / 1_000_000,
      confidence: stats.count > 20 ? 'high' : 'medium',
      metadata: { model, callCount: stats.count, avgSystemTokens: Math.round(stats.avgTokens) },
    });
  }
}

function analyzeToolUsage(
  toolEvents: AgentLensEvent[],
  suggestions: OptimizationSuggestion[],
): void {
  if (toolEvents.length < 5) return;

  // Group tool calls by session to find redundant consecutive calls
  const sessionTools = new Map<string, Array<{ tool: string; timestamp: string }>>();

  for (const evt of toolEvents) {
    const sessionId = evt.sessionId ?? '';
    const toolName = (evt.payload as any)?.toolName ?? (evt.payload as any)?.name ?? 'unknown';
    const list = sessionTools.get(sessionId) ?? [];
    list.push({ tool: toolName, timestamp: evt.timestamp });
    sessionTools.set(sessionId, list);
  }

  // Detect consecutive duplicate tool calls across sessions
  let totalCalls = 0;
  let redundantCalls = 0;
  const redundantTools = new Map<string, number>();

  for (const [, calls] of sessionTools) {
    for (let i = 1; i < calls.length; i++) {
      totalCalls++;
      if (calls[i].tool === calls[i - 1].tool) {
        redundantCalls++;
        redundantTools.set(calls[i].tool, (redundantTools.get(calls[i].tool) ?? 0) + 1);
      }
    }
  }

  if (totalCalls > 0 && redundantCalls / totalCalls > TOOL_REDUNDANCY_THRESHOLD) {
    const topRedundant = [...redundantTools.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([tool, count]) => `${tool} (${count}x)`);

    suggestions.push({
      type: 'tool_usage',
      description: `${Math.round((redundantCalls / totalCalls) * 100)}% of consecutive tool calls are duplicates. Top: ${topRedundant.join(', ')}. Consider deduplication or caching.`,
      estimatedSavings: 0, // Tool call cost is indirect
      confidence: totalCalls > 100 ? 'high' : 'medium',
      metadata: { totalCalls, redundantCalls, redundantRatio: redundantCalls / totalCalls },
    });
  }

  // Detect tools that are declared but never called (if metadata available)
  // This is a lightweight heuristic: if a tool appears < 1% of the time, flag it
  const toolFrequency = new Map<string, number>();
  for (const evt of toolEvents) {
    const toolName = (evt.payload as any)?.toolName ?? (evt.payload as any)?.name ?? 'unknown';
    toolFrequency.set(toolName, (toolFrequency.get(toolName) ?? 0) + 1);
  }

  const totalToolCalls = toolEvents.length;
  const rareTools = [...toolFrequency.entries()]
    .filter(([, count]) => count / totalToolCalls < 0.01 && totalToolCalls > 50)
    .map(([tool]) => tool);

  if (rareTools.length > 0) {
    suggestions.push({
      type: 'tool_usage',
      description: `Rarely used tools detected: ${rareTools.join(', ')}. Consider removing them from the tool list to reduce prompt size and model confusion.`,
      estimatedSavings: 0,
      confidence: 'low',
      metadata: { rareTools, totalToolCalls },
    });
  }
}
