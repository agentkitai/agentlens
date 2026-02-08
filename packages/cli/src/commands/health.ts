/**
 * agentlens health — Agent health scores and trends
 */
import { parseArgs } from 'node:util';
import { createClientFromConfig } from '../lib/client.js';
import { printTable, printJson } from '../lib/output.js';

const HELP = `Usage: agentlens health [options]

Display agent health scores and trends.

Options:
  --agent <id>          Show detailed health for a specific agent
  --history             Show health history trend (requires --agent)
  --window <days>       Time window in days (default: 7)
  --format <fmt>        Output format: table (default) or json
  --url <url>           Server URL (overrides config)
  -h, --help            Show help

Examples:
  agentlens health                              Overview of all agents
  agentlens health --agent my-agent             Detailed score with dimensions
  agentlens health --agent my-agent --history   Score trend over time
  agentlens health --format json                Raw JSON output`;

/** Color-code a score: green (≥75), yellow (50-74), red (<50) */
function colorScore(score: number): string {
  if (score >= 75) return `\x1b[32m${score}\x1b[0m`;  // green
  if (score >= 50) return `\x1b[33m${score}\x1b[0m`;  // yellow
  return `\x1b[31m${score}\x1b[0m`;                    // red
}

/** Trend arrow */
function trendIcon(trend: string, delta: number): string {
  if (trend === 'improving') return `↑ +${delta.toFixed(1)}`;
  if (trend === 'degrading') return `↓ ${delta.toFixed(1)}`;
  return `→ ${delta.toFixed(1)}`;
}

export async function runHealthCommand(argv: string[]): Promise<void> {
  const { values } = parseArgs({
    args: argv,
    options: {
      agent: { type: 'string', short: 'a' },
      history: { type: 'boolean', default: false },
      window: { type: 'string', short: 'w' },
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
  const windowDays = values.window ? parseInt(values.window, 10) : undefined;
  const isJson = values.format === 'json';

  if (values.agent && values.history) {
    // History trend for a specific agent
    const snapshots = await client.getHealthHistory(values.agent, windowDays ?? 30);

    if (isJson) {
      printJson(snapshots);
      return;
    }

    console.log(`\nHealth History — ${values.agent}\n`);
    if (snapshots.length === 0) {
      console.log('No history data available.');
      return;
    }

    const headers = ['Date', 'Overall', 'Error Rate', 'Cost Eff.', 'Tool Succ.', 'Latency', 'Completion', 'Sessions'];
    const rows = snapshots.map((s) => [
      s.date,
      colorScore(s.overallScore),
      colorScore(s.errorRateScore),
      colorScore(s.costEfficiencyScore),
      colorScore(s.toolSuccessScore),
      colorScore(s.latencyScore),
      colorScore(s.completionRateScore),
      String(s.sessionCount),
    ]);
    printTable(headers, rows);
  } else if (values.agent) {
    // Detailed health for a single agent
    const health = await client.getHealth(values.agent, windowDays);

    if (isJson) {
      printJson(health);
      return;
    }

    console.log(`\nAgent Health — ${health.agentId}\n`);
    console.log(`  Overall Score: ${colorScore(health.overallScore)}  ${trendIcon(health.trend, health.trendDelta)}`);
    console.log(`  Sessions:      ${health.sessionCount}`);
    console.log(`  Window:        ${health.window.from} → ${health.window.to}`);
    console.log(`  Computed at:   ${health.computedAt}`);
    console.log('');

    const headers = ['Dimension', 'Score', 'Weight', 'Raw Value', 'Description'];
    const rows = health.dimensions.map((d) => [
      d.name,
      colorScore(d.score),
      d.weight.toFixed(2),
      String(d.rawValue),
      d.description,
    ]);
    printTable(headers, rows);
  } else {
    // Overview of all agents
    const scores = await client.getHealthOverview(windowDays);

    if (isJson) {
      printJson(scores);
      return;
    }

    console.log('\nAgent Health Overview\n');
    if (scores.length === 0) {
      console.log('No agents found.');
      return;
    }

    const headers = ['Agent', 'Score', 'Trend', 'Sessions', 'Window'];
    const rows = scores.map((s) => [
      s.agentId,
      colorScore(s.overallScore),
      trendIcon(s.trend, s.trendDelta),
      String(s.sessionCount),
      `${s.window.from.slice(0, 10)} → ${s.window.to.slice(0, 10)}`,
    ]);
    printTable(headers, rows);
  }
}
