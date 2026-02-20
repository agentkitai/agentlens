/**
 * Content Guardrail Engine — Sync content evaluation orchestrator (Feature 8 — Story 7)
 */
import { ulid } from 'ulid';
import type {
  GuardrailRule,
  ContentGuardrailResult,
  ContentMatch,
  GuardrailDirection,
} from '@agentlensai/core';
import type { GuardrailStore } from '../../db/guardrail-store.js';
import { getScannerForRule, isContentRule } from './scanners/scanner-registry.js';
import { createLogger } from '../logger.js';

const log = createLogger('ContentGuardrailEngine');

const MAX_CONTENT_SIZE = 1024 * 1024; // 1MB
const DEFAULT_TIMEOUT_MS = 100;

export interface ContentEvalContext {
  tenantId: string;
  agentId: string;
  toolName: string;
  direction: 'input' | 'output';
}

/** Action priority for conflict resolution */
const ACTION_PRIORITY: Record<string, number> = {
  block: 100,
  redact: 50,
  alert: 20,
  log_and_continue: 10,
};

export class ContentGuardrailEngine {
  constructor(private readonly store: GuardrailStore) {}

  async evaluateContentSync(
    content: string,
    context: ContentEvalContext,
    timeoutMs: number = DEFAULT_TIMEOUT_MS,
  ): Promise<ContentGuardrailResult> {
    const startTime = performance.now();

    // Fast path
    if (!content || content.length === 0 || content.length > MAX_CONTENT_SIZE) {
      return { decision: 'allow', matches: [], evaluationMs: 0, rulesEvaluated: 0 };
    }

    // Load enabled content rules
    const allRules = this.store.listEnabledRules(context.tenantId, context.agentId);
    const contentRules = allRules
      .filter((r) => isContentRule(r))
      .filter((r) => this.matchesDirection(r, context.direction))
      .filter((r) => this.matchesToolName(r, context.toolName))
      .sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));

    if (contentRules.length === 0) {
      return { decision: 'allow', matches: [], evaluationMs: 0, rulesEvaluated: 0 };
    }

    const allMatches: ContentMatch[] = [];
    let highestAction = { type: 'allow', priority: -1, ruleId: '' };
    let rulesEvaluated = 0;

    for (const rule of contentRules) {
      if (performance.now() - startTime > timeoutMs) {
        log.warn('content evaluation timeout', { evaluated: rulesEvaluated, total: contentRules.length });
        break;
      }

      try {
        const scanner = getScannerForRule(rule);
        if (!scanner) continue;
        const result = scanner.isAsync
          ? await Promise.race([
              scanner.scan(content, { ...context }),
              new Promise<never>((_, reject) =>
                setTimeout(() => reject(new Error('scanner timeout')), timeoutMs / 2)),
            ])
          : scanner.scan(content, { ...context });

        const scanResult = result instanceof Promise ? await result : result;
        rulesEvaluated++;

        if (scanResult.matches.length > 0) {
          if (!rule.dryRun) {
            allMatches.push(...scanResult.matches);
            const actionPriority = ACTION_PRIORITY[rule.actionType] ?? 0;
            if (actionPriority > highestAction.priority) {
              highestAction = { type: rule.actionType, priority: actionPriority, ruleId: rule.id };
            }
          }

          // Record trigger async
          this.recordTriggerAsync(rule, scanResult.matches, context);

          // Short-circuit on block
          if (rule.actionType === 'block' && !rule.dryRun) {
            break;
          }
        }
      } catch (err) {
        log.error(`scanner error for rule ${rule.id}`, {
          error: err instanceof Error ? err.message : String(err),
        });
        // Fail-open
      }
    }

    const evaluationMs = Math.round((performance.now() - startTime) * 100) / 100;
    const decision = this.resolveDecision(highestAction.type, allMatches);

    const result: ContentGuardrailResult = {
      decision,
      matches: allMatches,
      evaluationMs,
      rulesEvaluated,
    };

    if (decision === 'block') {
      result.blockingRuleId = highestAction.ruleId;
    }
    if (decision === 'redact') {
      result.redactedContent = this.applyRedactions(content, allMatches);
    }

    return result;
  }

  private matchesDirection(rule: GuardrailRule, direction: 'input' | 'output'): boolean {
    const ruleDir = rule.direction as GuardrailDirection | undefined;
    if (!ruleDir || ruleDir === 'both') return true;
    return ruleDir === direction;
  }

  private matchesToolName(rule: GuardrailRule, toolName: string): boolean {
    const ruleTools = rule.toolNames;
    if (!ruleTools || ruleTools.length === 0) return true;
    return ruleTools.includes(toolName);
  }

  private resolveDecision(actionType: string, matches: ContentMatch[]): 'allow' | 'block' | 'redact' {
    if (matches.length === 0) return 'allow';
    if (actionType === 'block') return 'block';
    if (actionType === 'redact') return 'redact';
    return 'allow';
  }

  applyRedactions(content: string, matches: ContentMatch[]): string {
    const sorted = [...matches].sort((a, b) => b.offset.start - a.offset.start);
    let result = content;
    for (const match of sorted) {
      result = result.slice(0, match.offset.start) + match.redactionToken + result.slice(match.offset.end);
    }
    return result;
  }

  private recordTriggerAsync(
    rule: GuardrailRule,
    matches: ContentMatch[],
    context: ContentEvalContext,
  ): void {
    try {
      this.store.insertTrigger({
        id: ulid(),
        ruleId: rule.id,
        tenantId: rule.tenantId,
        triggeredAt: new Date().toISOString(),
        conditionValue: matches.length,
        conditionThreshold: 0,
        actionExecuted: !rule.dryRun,
        actionResult: rule.dryRun ? 'dry_run' : rule.actionType,
        metadata: {
          agentId: context.agentId,
          toolName: context.toolName,
          direction: context.direction,
          matchTypes: matches.map((m) => m.patternName),
          dryRun: rule.dryRun,
        },
      });
    } catch (err) {
      log.error('failed to record content trigger', {
        ruleId: rule.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}
