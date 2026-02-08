/**
 * agentlens reflect — Pattern analysis across agent sessions
 */
import { parseArgs } from 'node:util';
import { createClientFromConfig } from '../lib/client.js';
import { printTable, printJson, formatTimestamp, truncate } from '../lib/output.js';

const ANALYSIS_TYPES = ['error_patterns', 'cost_analysis', 'tool_sequences', 'performance_trends'] as const;

const HELP = `Usage: agentlens reflect <analysis_type> [options]

Analyze behavioral patterns from agent sessions.

Analysis Types:
  error_patterns        Recurring error patterns across sessions
  cost_analysis         Cost breakdown and trends by model/agent
  tool_sequences        Common tool usage patterns and error rates
  performance_trends    Success rate and duration trends over time

Options:
  --agent <id>          Filter by agent ID
  --from <date>         Start date (ISO 8601)
  --to <date>           End date (ISO 8601)
  --limit <n>           Maximum results (default: 20)
  --url <url>           Server URL (overrides config)
  -j, --json            Output raw JSON
  -h, --help            Show help

Examples:
  agentlens reflect error_patterns
  agentlens reflect cost_analysis --agent my-agent --from 2026-01-01
  agentlens reflect tool_sequences --limit 20
  agentlens reflect performance_trends`;

export async function runReflectCommand(argv: string[]): Promise<void> {
  const { values, positionals } = parseArgs({
    args: argv,
    options: {
      agent: { type: 'string', short: 'a' },
      from: { type: 'string' },
      to: { type: 'string' },
      limit: { type: 'string', short: 'l' },
      url: { type: 'string' },
      json: { type: 'boolean', short: 'j', default: false },
      help: { type: 'boolean', short: 'h', default: false },
    },
    allowPositionals: true,
  });

  if (values.help || positionals.length === 0) {
    console.log(HELP);
    return;
  }

  const analysis = positionals[0] as (typeof ANALYSIS_TYPES)[number];
  if (!ANALYSIS_TYPES.includes(analysis)) {
    console.error(`Unknown analysis type: ${analysis}`);
    console.error(`Valid types: ${ANALYSIS_TYPES.join(', ')}`);
    process.exit(1);
  }

  const client = createClientFromConfig(values.url);

  const result = await client.reflect({
    analysis,
    agentId: values.agent ?? undefined,
    from: values.from ?? undefined,
    to: values.to ?? undefined,
    limit: values.limit ? parseInt(values.limit, 10) : undefined,
  });

  if (values.json) {
    printJson(result);
    return;
  }

  // Dispatch to per-analysis-type formatter
  switch (analysis) {
    case 'error_patterns':
      formatErrorPatterns(result);
      break;
    case 'cost_analysis':
      formatCostAnalysis(result);
      break;
    case 'tool_sequences':
      formatToolSequences(result);
      break;
    case 'performance_trends':
      formatPerformanceTrends(result);
      break;
  }

  // Always show metadata
  const m = result.metadata;
  console.log(`\nAnalyzed ${m.sessionsAnalyzed} session(s), ${m.eventsAnalyzed} event(s).`);
  console.log(`Time range: ${m.timeRange.from} → ${m.timeRange.to}`);
}

function formatErrorPatterns(result: { insights: Array<{ type: string; summary: string; data: Record<string, unknown> }> }): void {
  console.log('\nError Patterns\n');

  if (result.insights.length === 0) {
    console.log('No error patterns found.');
    return;
  }

  const headers = ['Pattern', 'Count', 'First Seen', 'Last Seen'];
  const rows = result.insights.map((insight) => {
    const d = insight.data as Record<string, unknown>;
    return [
      truncate(insight.summary, 50),
      String(d.count ?? ''),
      d.firstSeen ? formatTimestamp(String(d.firstSeen)) : '',
      d.lastSeen ? formatTimestamp(String(d.lastSeen)) : '',
    ];
  });

  printTable(headers, rows);
}

function formatCostAnalysis(result: { insights: Array<{ type: string; summary: string; data: Record<string, unknown> }> }): void {
  console.log('\nCost Analysis\n');

  if (result.insights.length === 0) {
    console.log('No cost data found.');
    return;
  }

  // Look for summary insight
  const summaryInsight = result.insights.find((i) => i.type === 'cost_summary');
  if (summaryInsight) {
    const d = summaryInsight.data as Record<string, unknown>;
    console.log(`  Total Cost:       $${Number(d.totalCost ?? 0).toFixed(4)}`);
    console.log(`  Avg/Session:      $${Number(d.avgPerSession ?? 0).toFixed(4)}`);
    console.log(`  Total Sessions:   ${d.totalSessions ?? ''}`);
    console.log('');
  }

  // Look for model breakdown insights
  const modelInsights = result.insights.filter((i) => i.type === 'cost_by_model');
  if (modelInsights.length > 0) {
    console.log('Model Breakdown:');
    const headers = ['Model', 'Calls', 'Cost', 'Avg/Call'];
    const rows = modelInsights.map((insight) => {
      const d = insight.data as Record<string, unknown>;
      return [
        truncate(String(d.model ?? insight.summary), 30),
        String(d.callCount ?? d.calls ?? ''),
        `$${Number(d.totalCost ?? d.costUsd ?? 0).toFixed(4)}`,
        `$${Number(d.avgCostPerCall ?? 0).toFixed(4)}`,
      ];
    });
    printTable(headers, rows);
  }

  // If no structured data, show general insights
  if (!summaryInsight && modelInsights.length === 0) {
    for (const insight of result.insights) {
      console.log(`  [${insight.type}] ${insight.summary}`);
    }
  }
}

function formatToolSequences(result: { insights: Array<{ type: string; summary: string; data: Record<string, unknown> }> }): void {
  console.log('\nTool Sequences\n');

  if (result.insights.length === 0) {
    console.log('No tool sequence patterns found.');
    return;
  }

  const headers = ['Sequence', 'Frequency', 'Sessions', 'Error Rate'];
  const rows = result.insights.map((insight) => {
    const d = insight.data as Record<string, unknown>;
    const tools = d.tools as string[] | undefined;
    const seq = tools ? tools.join(' → ') : insight.summary;
    return [
      truncate(seq, 50),
      String(d.frequency ?? ''),
      String(d.sessions ?? ''),
      d.errorRate !== undefined ? `${(Number(d.errorRate) * 100).toFixed(1)}%` : '',
    ];
  });

  printTable(headers, rows);
}

function formatPerformanceTrends(result: { insights: Array<{ type: string; summary: string; data: Record<string, unknown>; confidence: number }> }): void {
  console.log('\nPerformance Trends\n');

  if (result.insights.length === 0) {
    console.log('No performance data found.');
    return;
  }

  // Look for current stats
  const currentInsight = result.insights.find((i) => i.type === 'current' || i.type === 'performance_current');
  if (currentInsight) {
    const d = currentInsight.data as Record<string, unknown>;
    console.log(`  Success Rate:    ${d.successRate !== undefined ? `${(Number(d.successRate) * 100).toFixed(1)}%` : 'N/A'}`);
    console.log(`  Avg Duration:    ${d.avgDuration !== undefined ? `${Number(d.avgDuration).toFixed(0)}ms` : 'N/A'}`);
    console.log(`  Avg Tool Calls:  ${d.avgToolCalls ?? 'N/A'}`);
    console.log(`  Avg Errors:      ${d.avgErrors ?? 'N/A'}`);
    console.log('');
  }

  // Look for assessment
  const assessmentInsight = result.insights.find((i) => i.type === 'assessment' || i.type === 'trend_assessment');
  if (assessmentInsight) {
    const assessment = String(assessmentInsight.data.assessment ?? assessmentInsight.summary);
    const icon = assessment === 'improving' ? '📈' : assessment === 'degrading' ? '📉' : '📊';
    console.log(`  Trend: ${icon} ${assessment}`);
    console.log('');
  }

  // Show trend data if present
  const trendInsights = result.insights.filter((i) => i.type === 'trend_bucket' || i.type === 'trend');
  if (trendInsights.length > 0) {
    const headers = ['Date', 'Success Rate', 'Duration', 'Errors'];
    const rows = trendInsights.map((insight) => {
      const d = insight.data as Record<string, unknown>;
      return [
        String(d.date ?? insight.summary),
        d.successRate !== undefined ? `${(Number(d.successRate) * 100).toFixed(1)}%` : '',
        d.duration !== undefined ? `${Number(d.duration).toFixed(0)}ms` : '',
        String(d.errors ?? ''),
      ];
    });
    printTable(headers, rows);
  }

  // Fallback: show all insights
  if (!currentInsight && !assessmentInsight && trendInsights.length === 0) {
    for (const insight of result.insights) {
      console.log(`  [${insight.type}] ${insight.summary} (confidence: ${(insight.confidence * 100).toFixed(0)}%)`);
    }
  }
}
