/**
 * MCP Guardrail Middleware (Feature 8 — Story 10)
 *
 * Wraps tool handlers to intercept input/output for content scanning.
 */
import type { ContentGuardrailResult } from '@agentkitai/agentlens-core';
export type { ContentGuardrailResult };

export interface ContentEvalContext {
  tenantId: string;
  agentId: string;
  toolName: string;
  direction: 'input' | 'output';
}

export interface ContentGuardrailEvaluator {
  evaluateContent(
    content: string,
    context: ContentEvalContext,
    timeoutMs?: number,
  ): Promise<ContentGuardrailResult>;
}

export interface GuardrailMiddlewareOptions {
  toolName: string;
  getAgentId: () => string | undefined;
  getTenantId: () => string;
  evaluator: ContentGuardrailEvaluator;
  timeoutMs?: number;
  /** When the evaluator errors/times out, allow the content through instead of
   *  blocking it. Default false (fail closed). Wire from AGENTLENS_GUARDRAIL_FAIL_OPEN. */
  failOpen?: boolean;
}

interface ToolResult {
  content: Array<{ type: string; text: string }>;
  isError?: boolean;
}

type ToolHandler = (args: Record<string, unknown>) => Promise<ToolResult>;

/**
 * Wrap a tool handler with content guardrail enforcement. If the evaluator
 * errors or times out, the call FAILS CLOSED by default (input error → request
 * blocked; output error → response blocked) so an unreachable guardrail server
 * can't silently pass unscanned content. Set options.failOpen (from
 * AGENTLENS_GUARDRAIL_FAIL_OPEN) to allow through instead.
 */
export function guardrailWrap(
  handler: ToolHandler,
  options: GuardrailMiddlewareOptions,
): ToolHandler {
  return async (args: Record<string, unknown>): Promise<ToolResult> => {
    const agentId = options.getAgentId();
    if (!agentId) {
      return handler(args);
    }

    const baseContext = {
      tenantId: options.getTenantId(),
      agentId,
      toolName: options.toolName,
    };

    // Phase 1: Scan Input
    const inputText = JSON.stringify(args);
    if (inputText) {
      try {
        const inputResult = await options.evaluator.evaluateContent(
          inputText,
          { ...baseContext, direction: 'input' as const },
          options.timeoutMs,
        );

        if (inputResult.decision === 'block') {
          return {
            content: [{ type: 'text', text: `Guardrail policy violation: request blocked.` }],
            isError: true,
          };
        }

        if (inputResult.decision === 'redact' && inputResult.redactedContent) {
          try {
            args = JSON.parse(inputResult.redactedContent);
          } catch {
            // Redaction broke JSON — fall back to original args
          }
        }
      } catch {
        // Evaluator errored/timed out. Fail closed by default (block); opt into
        // fail-open via options.failOpen for advisory-only deployments.
        if (!options.failOpen) {
          return {
            content: [{ type: 'text', text: 'Guardrail policy violation: request blocked (guardrail unavailable).' }],
            isError: true,
          };
        }
      }
    }

    // Phase 2: Execute Handler
    const result = await handler(args);

    // Phase 3: Scan Output
    if (!result.isError) {
      const outputText = result.content
        .filter((c) => c.type === 'text')
        .map((c) => c.text)
        .join('\n');

      if (outputText) {
        try {
          const outputResult = await options.evaluator.evaluateContent(
            outputText,
            { ...baseContext, direction: 'output' as const },
            options.timeoutMs,
          );

          if (outputResult.decision === 'block') {
            return {
              content: [{ type: 'text', text: 'Guardrail policy violation: response blocked due to sensitive content.' }],
              isError: true,
            };
          }

          if (outputResult.decision === 'redact' && outputResult.redactedContent) {
            return {
              content: [{ type: 'text', text: outputResult.redactedContent }],
            };
          }
        } catch {
          // Evaluator errored/timed out. Fail closed by default (block the
          // response so unscanned output can't leak); opt into fail-open.
          if (!options.failOpen) {
            return {
              content: [{ type: 'text', text: 'Guardrail policy violation: response blocked (guardrail unavailable).' }],
              isError: true,
            };
          }
        }
      }
    }

    return result;
  };
}
