/**
 * Analyzer Plugin Interface (Feature 17 — Story 17.1)
 */

import type { IEventStore, AgentLensEvent, EnhancedRecommendation } from '@agentlensai/core';

export interface AnalyzerContext {
  store: IEventStore;
  agentId?: string;
  from: string;
  to: string;
  period: number;
  limit: number;
  /** Pre-fetched llm_call events (shared across analyzers) */
  llmCallEvents: AgentLensEvent[];
  /** Pre-fetched llm_response events (shared across analyzers) */
  llmResponseEvents: AgentLensEvent[];
  /** callId → llm_response event map */
  responseMap: Map<string, AgentLensEvent>;
}

export interface Analyzer {
  readonly name: string;
  analyze(ctx: AnalyzerContext): Promise<EnhancedRecommendation[]>;
}
