/**
 * agentlens_benchmark MCP Tool (Stories 4.2, 4.3)
 *
 * Create, list, manage, and analyze A/B benchmarks.
 * Actions: create, list, status, results, start, complete.
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { AgentLensTransport } from '../transport.js';

// ─── Response Types ─────────────────────────────────────────────────

export interface BenchmarkVariant {
  name: string;
  tag: string;
  description?: string;
  sessionCount?: number;
}

export interface BenchmarkSummary {
  id: string;
  name: string;
  status: string;
  variants: BenchmarkVariant[];
  createdAt: string;
  description?: string;
}

export interface BenchmarkDetail extends BenchmarkSummary {
  metrics: string[];
  minSessions: number;
  agentId?: string;
  startedAt?: string;
  completedAt?: string;
}

export interface MetricResult {
  metric: string;
  variants: Array<{
    name: string;
    mean: number;
    stddev: number;
    n: number;
  }>;
  pValue?: number;
  significant: boolean;
  winner?: string;
  difference?: number;
  differencePercent?: number;
}

export interface BenchmarkResults {
  benchmarkId: string;
  name: string;
  status: string;
  metrics: MetricResult[];
  summary: string;
}

// ─── Formatting ─────────────────────────────────────────────────────

const STATUS_ICONS: Record<string, string> = {
  draft: '📝',
  running: '🏃',
  completed: '✅',
  cancelled: '❌',
};

function statusIcon(status: string): string {
  return STATUS_ICONS[status] ?? '❓';
}

/**
 * Confidence stars based on p-value.
 */
function confidenceStars(pValue: number | undefined): string {
  if (pValue === undefined) return '';
  if (pValue < 0.001) return ' ★★★';
  if (pValue < 0.01) return ' ★★';
  if (pValue < 0.05) return ' ★';
  return '';
}

/**
 * Format a benchmark list.
 */
export function formatBenchmarkList(benchmarks: BenchmarkSummary[]): string {
  if (benchmarks.length === 0) {
    return 'No benchmarks found.';
  }

  const lines: string[] = [];
  lines.push(`📊 Benchmarks (${benchmarks.length})`);
  lines.push('');

  for (const b of benchmarks) {
    const icon = statusIcon(b.status);
    const variantNames = b.variants.map((v) => v.name).join(' vs ');
    lines.push(`${icon} ${b.name} [${b.status}]`);
    lines.push(`   ID: ${b.id}`);
    lines.push(`   Variants: ${variantNames}`);
    if (b.description) {
      lines.push(`   ${b.description}`);
    }
    lines.push('');
  }

  return lines.join('\n').trimEnd();
}

/**
 * Format a created benchmark confirmation.
 */
export function formatBenchmarkCreated(benchmark: BenchmarkDetail): string {
  const lines: string[] = [];
  lines.push(`✅ Benchmark created: ${benchmark.name}`);
  lines.push('');
  lines.push(`ID: ${benchmark.id}`);
  lines.push(`Status: ${benchmark.status}`);
  lines.push(`Variants: ${benchmark.variants.map((v) => `${v.name} (tag: ${v.tag})`).join(', ')}`);
  if (benchmark.metrics.length > 0) {
    lines.push(`Metrics: ${benchmark.metrics.join(', ')}`);
  }
  lines.push(`Min Sessions: ${benchmark.minSessions}`);
  if (benchmark.agentId) {
    lines.push(`Agent: ${benchmark.agentId}`);
  }

  lines.push('');
  lines.push('Next steps:');
  lines.push('1. Tag sessions with variant tags');
  lines.push('2. Start the benchmark with action: "start"');
  lines.push('3. Collect data, then check with action: "results"');

  return lines.join('\n');
}

/**
 * Format benchmark status/detail.
 */
export function formatBenchmarkStatus(benchmark: BenchmarkDetail): string {
  const lines: string[] = [];
  const icon = statusIcon(benchmark.status);

  lines.push(`${icon} Benchmark: ${benchmark.name} [${benchmark.status}]`);
  lines.push('');
  lines.push(`ID: ${benchmark.id}`);
  if (benchmark.description) {
    lines.push(`Description: ${benchmark.description}`);
  }
  if (benchmark.agentId) {
    lines.push(`Agent: ${benchmark.agentId}`);
  }
  lines.push(`Created: ${benchmark.createdAt}`);
  if (benchmark.startedAt) lines.push(`Started: ${benchmark.startedAt}`);
  if (benchmark.completedAt) lines.push(`Completed: ${benchmark.completedAt}`);

  lines.push('');
  lines.push('Variants:');
  for (const v of benchmark.variants) {
    const count = v.sessionCount ?? 0;
    const progress = benchmark.minSessions > 0
      ? ` (${count}/${benchmark.minSessions})`
      : ` (${count} sessions)`;
    lines.push(`  • ${v.name} [${v.tag}]${progress}`);
    if (v.description) lines.push(`    ${v.description}`);
  }

  if (benchmark.metrics.length > 0) {
    lines.push('');
    lines.push(`Metrics: ${benchmark.metrics.join(', ')}`);
  }

  return lines.join('\n');
}

/**
 * Format benchmark results as an ASCII table.
 */
export function formatBenchmarkResults(results: BenchmarkResults): string {
  const lines: string[] = [];
  const icon = statusIcon(results.status);

  lines.push(`${icon} Benchmark Results: ${results.name}`);
  lines.push('');

  if (results.metrics.length === 0) {
    lines.push('No results available yet. Collect more data and try again.');
    return lines.join('\n');
  }

  // Build ASCII table
  // Collect all variant names
  const variantNames = results.metrics[0]!.variants.map((v) => v.name);

  // Header row
  const metricColWidth = Math.max(
    8,
    ...results.metrics.map((m) => m.metric.length),
  );
  const variantColWidth = Math.max(
    12,
    ...variantNames.map((n) => n.length + 2),
  );
  const statsColWidth = 14;

  const headerCols = ['Metric'.padEnd(metricColWidth)];
  for (const name of variantNames) {
    headerCols.push(name.padEnd(variantColWidth));
  }
  headerCols.push('p-value'.padEnd(statsColWidth));
  headerCols.push('Result');

  const headerLine = '| ' + headerCols.join(' | ') + ' |';
  const separator = '|' + headerCols.map((col) => '-'.repeat(col.length + 2)).join('|') + '|';

  lines.push(headerLine);
  lines.push(separator);

  // Data rows
  for (const metric of results.metrics) {
    const cols: string[] = [metric.metric.padEnd(metricColWidth)];

    for (const variant of metric.variants) {
      const val = `${variant.mean.toFixed(2)}±${variant.stddev.toFixed(2)}`;
      cols.push(val.padEnd(variantColWidth));
    }

    const pStr = metric.pValue !== undefined ? metric.pValue.toFixed(4) : 'n/a';
    cols.push(pStr.padEnd(statsColWidth));

    let resultStr = metric.significant ? `${metric.winner ?? '?'} wins` : 'no sig. diff.';
    resultStr += confidenceStars(metric.pValue);

    cols.push(resultStr);

    lines.push('| ' + cols.join(' | ') + ' |');
  }

  lines.push('');
  lines.push(`Confidence: ★ p<0.05  ★★ p<0.01  ★★★ p<0.001`);

  if (results.summary) {
    lines.push('');
    lines.push(`Summary: ${results.summary}`);
  }

  return lines.join('\n');
}

// ─── Tool Registration ──────────────────────────────────────────────

const variantSchema = z.object({
  name: z.string().describe('Variant display name'),
  tag: z.string().describe('Tag to associate sessions with this variant'),
  description: z.string().optional().describe('Variant description'),
});

export function registerBenchmarkTool(server: McpServer, transport: AgentLensTransport): void {
  server.tool(
    'agentlens_benchmark',
    `Manage A/B benchmarks: create, list, check status, get results, and control lifecycle.

**When to use:** To set up controlled experiments comparing different agent configurations (models, prompts, parameters), track which variant performs better, and get statistical results.

**Workflow:**
1. \`create\` — Define a benchmark with 2+ variants and metrics
2. Tag sessions with variant tags during data collection
3. \`start\` — Transition benchmark to running
4. \`status\` — Check progress (session counts per variant)
5. \`results\` — Get statistical comparison with p-values
6. \`complete\` — Finalize the benchmark

**Actions:**
- \`create\`: Set up a new benchmark (name, variants[], metrics[])
- \`list\`: List benchmarks, optionally filter by status
- \`status\`: Get benchmark detail with per-variant session counts
- \`results\`: Get formatted comparison table with statistical analysis
- \`start\`: Transition benchmark to running state
- \`complete\`: Transition benchmark to completed state

**Example:** agentlens_benchmark({ action: "create", name: "GPT-4o vs Claude", variants: [{name: "gpt4o", tag: "v-gpt4o"}, {name: "claude", tag: "v-claude"}], metrics: ["cost", "latency", "success_rate"] })`,
    {
      action: z
        .enum(['create', 'list', 'status', 'results', 'start', 'complete'])
        .describe('Action to perform'),
      // Create params
      name: z.string().optional().describe('Benchmark name (required for create)'),
      description: z.string().optional().describe('Benchmark description'),
      variants: z
        .array(variantSchema)
        .optional()
        .describe('Variants to compare (required for create, min 2)'),
      metrics: z
        .array(z.string())
        .optional()
        .describe('Metrics to track (e.g., ["cost", "latency", "success_rate"])'),
      minSessions: z
        .number()
        .int()
        .optional()
        .describe('Minimum sessions per variant before results are meaningful'),
      agentId: z.string().optional().describe('Agent ID to scope the benchmark to'),
      // List params
      status: z.string().optional().describe('Filter by status (for list action)'),
      // Status/Results/Lifecycle params
      benchmarkId: z.string().optional().describe('Benchmark ID (required for status/results/start/complete)'),
    },
    async (params) => {
      try {
        switch (params.action) {
          case 'create':
            return await handleCreate(transport, params);
          case 'list':
            return await handleList(transport, params);
          case 'status':
            return await handleStatus(transport, params);
          case 'results':
            return await handleResults(transport, params);
          case 'start':
            return await handleStart(transport, params);
          case 'complete':
            return await handleComplete(transport, params);
          default:
            return {
              content: [
                {
                  type: 'text' as const,
                  text: `Unknown action: ${params.action as string}`,
                },
              ],
              isError: true,
            };
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';

        if (message.includes('404')) {
          return {
            content: [
              {
                type: 'text' as const,
                text: `Benchmark not found. Check the benchmark ID and try again.`,
              },
            ],
            isError: true,
          };
        }

        return {
          content: [
            {
              type: 'text' as const,
              text: `Error: ${message}`,
            },
          ],
          isError: true,
        };
      }
    },
  );
}

type ToolResult = {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
};

async function handleCreate(
  transport: AgentLensTransport,
  params: {
    name?: string;
    description?: string;
    variants?: Array<{ name: string; tag: string; description?: string }>;
    metrics?: string[];
    minSessions?: number;
    agentId?: string;
  },
): Promise<ToolResult> {
  // Validation
  if (!params.name) {
    return {
      content: [{ type: 'text' as const, text: 'Validation error: "name" is required for create action.' }],
      isError: true,
    };
  }
  if (!params.variants || params.variants.length < 2) {
    return {
      content: [
        { type: 'text' as const, text: 'Validation error: At least 2 variants are required for create action.' },
      ],
      isError: true,
    };
  }

  const body: Record<string, unknown> = {
    name: params.name,
    variants: params.variants,
  };
  if (params.description) body.description = params.description;
  if (params.metrics) body.metrics = params.metrics;
  if (params.minSessions !== undefined) body.minSessions = params.minSessions;
  if (params.agentId) body.agentId = params.agentId;

  const data = (await transport.createBenchmark(body)) as BenchmarkDetail;

  return {
    content: [{ type: 'text' as const, text: formatBenchmarkCreated(data) }],
  };
}

async function handleList(
  transport: AgentLensTransport,
  params: { status?: string },
): Promise<ToolResult> {
  const data = (await transport.listBenchmarks(params.status)) as {
    benchmarks: BenchmarkSummary[];
  };

  return {
    content: [{ type: 'text' as const, text: formatBenchmarkList(data.benchmarks) }],
  };
}

async function handleStatus(
  transport: AgentLensTransport,
  params: { benchmarkId?: string },
): Promise<ToolResult> {
  if (!params.benchmarkId) {
    return {
      content: [{ type: 'text' as const, text: 'Validation error: "benchmarkId" is required for status action.' }],
      isError: true,
    };
  }

  const data = (await transport.getBenchmark(params.benchmarkId)) as BenchmarkDetail;

  return {
    content: [{ type: 'text' as const, text: formatBenchmarkStatus(data) }],
  };
}

async function handleResults(
  transport: AgentLensTransport,
  params: { benchmarkId?: string },
): Promise<ToolResult> {
  if (!params.benchmarkId) {
    return {
      content: [{ type: 'text' as const, text: 'Validation error: "benchmarkId" is required for results action.' }],
      isError: true,
    };
  }

  const data = (await transport.getBenchmarkResults(
    params.benchmarkId,
  )) as BenchmarkResults;

  return {
    content: [{ type: 'text' as const, text: formatBenchmarkResults(data) }],
  };
}

async function handleStart(
  transport: AgentLensTransport,
  params: { benchmarkId?: string },
): Promise<ToolResult> {
  if (!params.benchmarkId) {
    return {
      content: [{ type: 'text' as const, text: 'Validation error: "benchmarkId" is required for start action.' }],
      isError: true,
    };
  }

  const data = (await transport.updateBenchmarkStatus(
    params.benchmarkId,
    'running',
  )) as BenchmarkDetail;

  return {
    content: [
      {
        type: 'text' as const,
        text: `🏃 Benchmark "${data.name}" is now running.\n\nTag sessions with variant tags to collect data. Check progress with action: "status".`,
      },
    ],
  };
}

async function handleComplete(
  transport: AgentLensTransport,
  params: { benchmarkId?: string },
): Promise<ToolResult> {
  if (!params.benchmarkId) {
    return {
      content: [{ type: 'text' as const, text: 'Validation error: "benchmarkId" is required for complete action.' }],
      isError: true,
    };
  }

  const data = (await transport.updateBenchmarkStatus(
    params.benchmarkId,
    'completed',
  )) as BenchmarkDetail & { results?: BenchmarkResults };

  let text = `✅ Benchmark "${data.name}" is now completed.`;

  if (data.results) {
    text += '\n\n' + formatBenchmarkResults(data.results);
  }

  return {
    content: [{ type: 'text' as const, text }],
  };
}
