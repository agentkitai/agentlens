/**
 * Auto-discovery capabilities module (Feature 10, Story 10.2)
 *
 * Maps tools to required server features, implements allowlist/denylist/feature-check
 * priority chain for conditional tool registration.
 */

export interface ServerInfo {
  version: string;
  features: string[];
}

export interface ToolRegistrationOptions {
  serverInfo: ServerInfo | null;
  allowlist: string[] | null;
  denylist: string[] | null;
}

export interface RegistrationDecision {
  register: boolean;
  reason?: string;
}

/** Map of tool name → required server feature(s). Empty = always register. */
export const TOOL_FEATURE_MAP: Record<string, string[]> = {
  // Core ingest tools — always registered
  agentlens_session_start: [],
  agentlens_log_event: [],
  agentlens_session_end: [],
  agentlens_query_events: [],
  agentlens_log_llm_call: [],
  // Existing feature tools
  agentlens_recall: ['recall'],
  agentlens_reflect: ['reflect'],
  agentlens_optimize: ['optimize'],
  agentlens_context: ['context'],
  agentlens_health: ['health'],
  agentlens_replay: ['replay'],
  agentlens_benchmark: ['benchmarks'],
  agentlens_guardrails: ['guardrails'],
  agentlens_discover: ['discovery'],
  agentlens_delegate: ['delegation'],
  // New tools (Feature 10)
  agentlens_sessions: ['sessions'],
  agentlens_agents: ['agents'],
  agentlens_alerts: ['alerts'],
  agentlens_analytics: ['analytics'],
  agentlens_cost_budgets: ['cost-budgets'],
  agentlens_lessons: ['lessons'],
  agentlens_stats: ['stats'],
  agentlens_trust: ['trust'],
  // Feature 19: Prompt Management
  agentlens_prompts: ['prompts'],
};

/**
 * Determine if a tool should be registered.
 * Priority: allowlist → denylist → feature-check.
 * When serverInfo is null (probe failed), all tools register (graceful fallback).
 */
export function shouldRegisterTool(
  toolName: string,
  options: ToolRegistrationOptions,
): RegistrationDecision {
  const shortName = toolName.replace('agentlens_', '');

  // 1. Allowlist takes highest priority
  if (options.allowlist) {
    if (!options.allowlist.includes(toolName) && !options.allowlist.includes(shortName)) {
      return { register: false, reason: 'not in allowlist' };
    }
  }

  // 2. Denylist
  if (options.denylist) {
    if (options.denylist.includes(toolName) || options.denylist.includes(shortName)) {
      return { register: false, reason: 'in denylist' };
    }
  }

  // 3. Feature availability (only if serverInfo was obtained)
  const requiredFeatures = TOOL_FEATURE_MAP[toolName] ?? [];
  if (options.serverInfo && requiredFeatures.length > 0) {
    const missing = requiredFeatures.filter(f => !options.serverInfo!.features.includes(f));
    if (missing.length > 0) {
      return { register: false, reason: `server missing features: ${missing.join(', ')}` };
    }
  }

  // 4. No serverInfo + has requirements = register anyway (graceful degradation)
  return { register: true };
}
