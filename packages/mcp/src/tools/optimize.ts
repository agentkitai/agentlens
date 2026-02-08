/**
 * agentlens_optimize MCP Tool (Story 2.5)
 *
 * Provides cost optimization recommendations via the optimize endpoint.
 * Tool name: agentlens_optimize
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { AgentLensTransport } from '../transport.js';

interface CostRecommendation {
  currentModel: string;
  recommendedModel: string;
  complexityTier: string;
  currentCostPerCall: number;
  recommendedCostPerCall: number;
  monthlySavings: number;
  callVolume: number;
  currentSuccessRate: number;
  recommendedSuccessRate: number;
  confidence: string;
  agentId: string;
}

interface OptimizationResult {
  recommendations: CostRecommendation[];
  totalPotentialSavings: number;
  period: number;
  analyzedCalls: number;
}

export function registerOptimizeTool(server: McpServer, transport: AgentLensTransport): void {
  server.tool(
    'agentlens_optimize',
    `Get cost optimization recommendations. Analyzes LLM call patterns and suggests cheaper model alternatives.

**When to use:** To identify cost-saving opportunities by switching expensive models to cheaper alternatives for tasks that don't require the most capable model. Analyzes call complexity (simple/moderate/complex) and success rates.

**What it returns:** A list of model switch recommendations with estimated monthly savings, confidence levels, and success rate comparisons. Sorted by potential savings.

**Example:** agentlens_optimize({ period: 7 }) → returns recommendations like "Switch gpt-4o → gpt-4o-mini for SIMPLE tasks, saving $89/month".`,
    {
      period: z.number().optional().describe('Analysis period in days (default: 7, max: 90)'),
      limit: z.number().optional().describe('Max recommendations to return (default: 5, max: 50)'),
    },
    async ({ period, limit }) => {
      try {
        const result = (await transport.getOptimizationRecommendations({
          period: period ?? 7,
          limit: limit ?? 5,
        })) as OptimizationResult;

        const text = formatOptimizationResult(result);

        return {
          content: [
            {
              type: 'text' as const,
              text,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `Error getting optimization recommendations: ${error instanceof Error ? error.message : 'Unknown error'}`,
            },
          ],
          isError: true,
        };
      }
    },
  );
}

/**
 * Format the optimization result as a readable text block.
 */
function formatOptimizationResult(result: OptimizationResult): string {
  if (result.recommendations.length === 0) {
    if (result.analyzedCalls === 0) {
      return '💰 Cost Optimization Recommendations\n\nNo LLM call data found for the analysis period. Start logging calls to get recommendations!';
    }
    return `💰 Cost Optimization Recommendations\n\nAnalyzed ${result.analyzedCalls.toLocaleString()} calls over ${result.period} days.\n\nNo recommendations? Your model usage is already optimized! 🎉`;
  }

  const lines: string[] = [];
  lines.push('💰 Cost Optimization Recommendations');
  lines.push('');
  lines.push(
    `Total Potential Savings: $${result.totalPotentialSavings.toFixed(2)}/month (analyzed ${result.analyzedCalls.toLocaleString()} calls over ${result.period} days)`,
  );

  for (let i = 0; i < result.recommendations.length; i++) {
    const rec = result.recommendations[i]!;
    lines.push('');
    lines.push(
      `${i + 1}. Switch ${rec.currentModel} → ${rec.recommendedModel} for ${rec.complexityTier.toUpperCase()} tasks`,
    );
    lines.push(
      `   Savings: $${rec.monthlySavings.toFixed(2)}/month | Confidence: ${rec.confidence.toUpperCase()} (${rec.callVolume} calls)`,
    );
    lines.push(
      `   Current success: ${(rec.currentSuccessRate * 100).toFixed(0)}% → Recommended success: ${(rec.recommendedSuccessRate * 100).toFixed(0)}%`,
    );
  }

  return lines.join('\n');
}
