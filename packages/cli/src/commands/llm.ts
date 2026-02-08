/**
 * agentlens llm — LLM call tracking stats, model breakdown, and recent calls
 */
import { parseArgs } from 'node:util';
import type { EventType } from '@agentlensai/sdk';
import { createClientFromConfig } from '../lib/client.js';
import { printTable, printJson, formatTimestamp, truncate } from '../lib/output.js';

const HELP = `Usage: agentlens llm <subcommand> [options]

Subcommands:
  stats               Show LLM usage summary
  models              List models with cost breakdown
  recent              Show recent LLM calls

Options:
  --from <date>       Start date (ISO 8601)
  --to <date>         End date (ISO 8601)
  --agent <id>        Filter by agent ID
  --model <name>      Filter by model name
  --url <url>         Server URL (overrides config)
  -j, --json          Output raw JSON
  -h, --help          Show help`;

export async function runLlmCommand(argv: string[]): Promise<void> {
  const subcommand = argv[0];
  const rest = argv.slice(1);

  switch (subcommand) {
    case 'stats':
      await runLlmStats(rest);
      break;
    case 'models':
      await runLlmModels(rest);
      break;
    case 'recent':
      await runLlmRecent(rest);
      break;
    case '--help':
    case '-h':
    case undefined:
      console.log(HELP);
      break;
    default:
      console.error(`Unknown llm subcommand: ${subcommand}`);
      console.log(HELP);
      process.exit(1);
  }
}

function parseLlmArgs(argv: string[]) {
  return parseArgs({
    args: argv,
    options: {
      from: { type: 'string' },
      to: { type: 'string' },
      agent: { type: 'string', short: 'a' },
      model: { type: 'string', short: 'm' },
      url: { type: 'string' },
      json: { type: 'boolean', short: 'j', default: false },
      help: { type: 'boolean', short: 'h', default: false },
    },
    allowPositionals: false,
  });
}

function formatCost(usd: number): string {
  return `$${usd.toFixed(4)}`;
}

function formatNumber(n: number): string {
  return n.toLocaleString('en-US');
}

function formatLatency(ms: number): string {
  return `${formatNumber(Math.round(ms))}ms`;
}

/**
 * agentlens llm stats — show LLM usage summary
 */
async function runLlmStats(argv: string[]): Promise<void> {
  const { values } = parseLlmArgs(argv);

  if (values.help) {
    console.log(`Usage: agentlens llm stats [options]

Show overall LLM usage summary: total calls, cost, tokens, and latency.

Options:
  --from <date>       Start date (ISO 8601)
  --to <date>         End date (ISO 8601)
  --agent <id>        Filter by agent ID
  --model <name>      Filter by model name
  --url <url>         Server URL (overrides config)
  -j, --json          Output raw JSON
  -h, --help          Show help`);
    return;
  }

  const client = createClientFromConfig(values.url);

  const analytics = await client.getLlmAnalytics({
    from: values.from ?? undefined,
    to: values.to ?? undefined,
    agentId: values.agent ?? undefined,
    model: values.model ?? undefined,
  });

  if (values.json) {
    printJson(analytics.summary);
    return;
  }

  const s = analytics.summary;
  const totalTokens = s.totalInputTokens + s.totalOutputTokens;

  console.log('');
  console.log('LLM Usage Summary');
  console.log(`  Total Calls:     ${formatNumber(s.totalCalls)}`);
  console.log(`  Total Cost:      ${formatCost(s.totalCostUsd)}`);
  console.log(`  Total Tokens:    ${formatNumber(totalTokens)} (${formatNumber(s.totalInputTokens)} in / ${formatNumber(s.totalOutputTokens)} out)`);
  console.log(`  Avg Latency:     ${formatLatency(s.avgLatencyMs)}`);
  console.log(`  Avg Cost/Call:   ${formatCost(s.avgCostPerCall)}`);
  console.log('');
}

/**
 * agentlens llm models — list models with cost breakdown
 */
async function runLlmModels(argv: string[]): Promise<void> {
  const { values } = parseLlmArgs(argv);

  if (values.help) {
    console.log(`Usage: agentlens llm models [options]

List models used with cost breakdown.

Options:
  --from <date>       Start date (ISO 8601)
  --to <date>         End date (ISO 8601)
  --agent <id>        Filter by agent ID
  --model <name>      Filter by model name
  --url <url>         Server URL (overrides config)
  -j, --json          Output raw JSON
  -h, --help          Show help`);
    return;
  }

  const client = createClientFromConfig(values.url);

  const analytics = await client.getLlmAnalytics({
    from: values.from ?? undefined,
    to: values.to ?? undefined,
    agentId: values.agent ?? undefined,
    model: values.model ?? undefined,
  });

  if (values.json) {
    printJson(analytics.byModel);
    return;
  }

  if (analytics.byModel.length === 0) {
    console.log('No LLM calls found.');
    return;
  }

  const headers = ['Provider', 'Model', 'Calls', 'Tokens', 'Cost', 'Avg Latency'];
  const rows = analytics.byModel.map((m) => [
    m.provider,
    truncate(m.model, 28),
    formatNumber(m.calls),
    formatNumber(m.inputTokens + m.outputTokens),
    formatCost(m.costUsd),
    formatLatency(m.avgLatencyMs),
  ]);

  printTable(headers, rows);
  console.log(`\n${analytics.byModel.length} model(s).`);
}

/**
 * agentlens llm recent — show recent LLM calls
 */
async function runLlmRecent(argv: string[]): Promise<void> {
  const { values } = parseLlmArgs(argv);

  if (values.help) {
    console.log(`Usage: agentlens llm recent [options]

Show recent LLM calls with latency and cost.

Options:
  --from <date>       Start date (ISO 8601)
  --to <date>         End date (ISO 8601)
  --agent <id>        Filter by agent ID
  --model <name>      Filter by model name
  --url <url>         Server URL (overrides config)
  -j, --json          Output raw JSON
  -h, --help          Show help`);
    return;
  }

  const client = createClientFromConfig(values.url);

  // Query recent llm_response events (they carry all the metrics)
  const result = await client.queryEvents({
    eventType: 'llm_response' as EventType,
    from: values.from ?? undefined,
    to: values.to ?? undefined,
    agentId: values.agent ?? undefined,
    limit: 10,
    order: 'desc',
  });

  if (values.json) {
    printJson(result);
    return;
  }

  if (result.events.length === 0) {
    console.log('No recent LLM calls found.');
    return;
  }

  // Filter by model if specified (server may not support model filter on events query)
  let events = result.events;
  if (values.model) {
    events = events.filter((e) => {
      const p = e.payload as Record<string, unknown>;
      return p['model'] === values.model;
    });
  }

  const headers = ['Timestamp', 'Model', 'Tokens', 'Cost', 'Latency', 'Finish'];
  const rows = events.map((e) => {
    const p = e.payload as Record<string, unknown>;
    const usage = p['usage'] as Record<string, number> | undefined;
    const totalTokens = usage?.['totalTokens'] ?? 0;
    const costUsd = (p['costUsd'] as number) ?? 0;
    const latencyMs = (p['latencyMs'] as number) ?? 0;
    const model = String(p['model'] ?? 'unknown');
    const finishReason = String(p['finishReason'] ?? '');

    return [
      formatTimestamp(e.timestamp),
      truncate(model, 24),
      formatNumber(totalTokens),
      formatCost(costUsd),
      formatLatency(latencyMs),
      finishReason,
    ];
  });

  printTable(headers, rows);
  console.log(`\nShowing ${events.length} of ${result.total} LLM calls.`);
}
