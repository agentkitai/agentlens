/**
 * agentlens optimize — Cost optimization recommendations
 */
import { parseArgs } from 'node:util';
import { createClientFromConfig } from '../lib/client.js';
import { printTable, printJson, truncate } from '../lib/output.js';

const HELP = `Usage: agentlens optimize [options]

Display cost optimization recommendations.

Options:
  --agent <id>          Filter recommendations for a specific agent
  --period <days>       Analysis period in days (default: 30)
  --limit <n>           Maximum recommendations (default: 10)
  --format <fmt>        Output format: table (default) or json
  --url <url>           Server URL (overrides config)
  -h, --help            Show help

Examples:
  agentlens optimize                            All recommendations
  agentlens optimize --agent my-agent           Agent-specific recommendations
  agentlens optimize --period 7 --limit 5       Last 7 days, top 5
  agentlens optimize --format json              Raw JSON output`;

/** Color-code a confidence level */
function colorConfidence(confidence: string): string {
  if (confidence === 'high') return `\x1b[32m${confidence}\x1b[0m`;    // green
  if (confidence === 'medium') return `\x1b[33m${confidence}\x1b[0m`;  // yellow
  return `\x1b[31m${confidence}\x1b[0m`;                               // red
}

/** Color-code a score: green (≥75), yellow (50-74), red (<50) */
function colorScore(score: number): string {
  if (score >= 75) return `\x1b[32m${score}\x1b[0m`;
  if (score >= 50) return `\x1b[33m${score}\x1b[0m`;
  return `\x1b[31m${score}\x1b[0m`;
}

export async function runOptimizeCommand(argv: string[]): Promise<void> {
  const { values } = parseArgs({
    args: argv,
    options: {
      agent: { type: 'string', short: 'a' },
      period: { type: 'string', short: 'p' },
      limit: { type: 'string', short: 'l' },
      format: { type: 'string', short: 'f' },
      url: { type: 'string' },
      help: { type: 'boolean', short: 'h', default: false },
    },
    allowPositionals: false,
  });

  if (values.help) {
    console.log(HELP);
    return;
  }

  const client = createClientFromConfig(values.url);
  const isJson = values.format === 'json';

  const result = await client.getOptimizationRecommendations({
    agentId: values.agent ?? undefined,
    period: values.period ? parseInt(values.period, 10) : undefined,
    limit: values.limit ? parseInt(values.limit, 10) : undefined,
  });

  if (isJson) {
    printJson(result);
    return;
  }

  console.log('\nOptimization Recommendations\n');

  if (result.recommendations.length === 0) {
    console.log('No recommendations found.');
    return;
  }

  console.log(`  Period:            ${result.period} days`);
  console.log(`  Analyzed Calls:    ${result.analyzedCalls.toLocaleString()}`);
  console.log(`  Potential Savings: $${result.totalPotentialSavings.toFixed(2)}/month`);
  console.log('');

  const headers = ['Agent', 'Current Model', 'Recommended', 'Tier', 'Savings/mo', 'Confidence'];
  const rows = result.recommendations.map((r) => [
    truncate(r.agentId, 20),
    truncate(r.currentModel, 22),
    truncate(r.recommendedModel, 22),
    r.complexityTier,
    `$${r.monthlySavings.toFixed(2)}`,
    colorConfidence(r.confidence),
  ]);
  printTable(headers, rows);
}
