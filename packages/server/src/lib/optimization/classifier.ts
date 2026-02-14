/**
 * Complexity Classifier (Story 2.2)
 *
 * Classifies LLM calls into complexity tiers based on token usage
 * and tool call count. Used by the optimization engine to group
 * calls for model-downgrade recommendations.
 */

import type { AgentLensEvent, ComplexityTier, LlmCallPayload, LlmResponsePayload } from '@agentlensai/core';

export interface ClassificationSignals {
  inputTokens: number;
  outputTokens: number;
  toolCallCount: number;
}

export interface ClassificationResult {
  tier: ComplexityTier;
  signals: ClassificationSignals;
}

/**
 * Classify an LLM call's complexity based on token usage and tool calls.
 *
 * Thresholds:
 *   Simple:   <1000 input tokens AND 0 tool calls
 *   Moderate: 1000-10000 input tokens OR 1-5 tool calls
 *   Complex:  10000-50000 input tokens OR 6-15 tool calls
 *   Expert:   >50000 input tokens OR 16+ tool calls
 *
 * When both input tokens and tool call count are unknown (null/undefined),
 * the function defaults to 'moderate' as the safest assumption.
 *
 * @param callEvent   - The llm_call event
 * @param responseEvent - The paired llm_response event (optional)
 * @returns Classification result with tier and signals used
 */
export function classifyCallComplexity(
  callEvent: AgentLensEvent,
  responseEvent?: AgentLensEvent | null,
): ClassificationResult {
  const callPayload = callEvent.payload as Partial<LlmCallPayload>;
  const responsePayload = responseEvent?.payload as Partial<LlmResponsePayload> | undefined;

  // Extract signals from whichever source is available
  const inputTokens = extractInputTokens(callPayload, responsePayload);
  const outputTokens = extractOutputTokens(responsePayload);
  const toolCallCount = extractToolCallCount(callPayload, responsePayload);

  const signals: ClassificationSignals = {
    inputTokens: inputTokens ?? 0,
    outputTokens: outputTokens ?? 0,
    toolCallCount: toolCallCount ?? 0,
  };

  const tier = determineTier(inputTokens, toolCallCount);

  return { tier, signals };
}

/**
 * Extract input token count from call or response payload.
 * Returns null if unavailable from either source.
 */
function extractInputTokens(
  callPayload: Partial<LlmCallPayload>,
  responsePayload?: Partial<LlmResponsePayload>,
): number | null {
  // Prefer response usage (actual) over call usage (estimated)
  const fromResponse = responsePayload?.usage?.inputTokens;
  if (fromResponse != null && fromResponse >= 0) return fromResponse;

  // Some implementations attach usage directly on the call payload
  const callWithUsage = callPayload as Record<string, unknown>;
  const usage = callWithUsage.usage as { inputTokens?: number } | undefined;
  if (usage?.inputTokens != null && usage.inputTokens >= 0) return usage.inputTokens;

  return null;
}

/**
 * Extract output token count from response payload.
 */
function extractOutputTokens(
  responsePayload?: Partial<LlmResponsePayload>,
): number | null {
  const fromResponse = responsePayload?.usage?.outputTokens;
  if (fromResponse != null && fromResponse >= 0) return fromResponse;
  return null;
}

/**
 * Extract tool call count.
 * Checks: call payload's tools (definitions provided), then response payload's
 * toolCalls (actual invocations). Uses whichever is available.
 */
function extractToolCallCount(
  callPayload: Partial<LlmCallPayload>,
  responsePayload?: Partial<LlmResponsePayload>,
): number | null {
  // Response toolCalls = actual tool invocations (preferred)
  if (responsePayload?.toolCalls != null) {
    return responsePayload.toolCalls.length;
  }

  // No actual tool calls in response — default to 0
  // (Don't fall back to tools definitions count, which is available tools, not invocations)
  return 0;
}

/**
 * Determine tier from extracted signals.
 * If both inputs are null, defaults to 'moderate' (safe fallback).
 */
function determineTier(
  inputTokens: number | null,
  toolCallCount: number | null,
): ComplexityTier {
  const tokensKnown = inputTokens != null;
  const toolsKnown = toolCallCount != null;

  // If we have no data at all, default to moderate
  if (!tokensKnown && !toolsKnown) {
    return 'moderate';
  }

  // Check expert thresholds first (most restrictive)
  if (tokensKnown && inputTokens! > 50000) return 'expert';
  if (toolsKnown && toolCallCount! >= 16) return 'expert';

  // Check complex thresholds
  if (tokensKnown && inputTokens! > 10000) return 'complex';
  if (toolsKnown && toolCallCount! >= 6) return 'complex';

  // Check simple thresholds (requires BOTH conditions)
  if (tokensKnown && inputTokens! < 1000 && toolsKnown && toolCallCount! === 0) {
    return 'simple';
  }
  // If only tokens known and <1000 with no tool info → can't confirm simple
  if (tokensKnown && inputTokens! < 1000 && !toolsKnown) {
    return 'moderate';
  }
  // If only tools known and 0 with no token info → can't confirm simple
  if (!tokensKnown && toolsKnown && toolCallCount! === 0) {
    return 'moderate';
  }

  // Everything else is moderate
  return 'moderate';
}
