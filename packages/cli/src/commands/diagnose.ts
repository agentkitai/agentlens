/**
 * agentlens diagnose — AI-powered diagnostics & root cause analysis [F18-S9]
 */
import { parseArgs } from 'node:util';
import { loadConfig } from '../lib/config.js';
import { printJson } from '../lib/output.js';

const HELP = `Usage: agentlens diagnose <agentId> [options]
       agentlens diagnose --session <sessionId> [options]

Run AI-powered diagnostics on an agent or session.

Options:
  --session <id>        Diagnose a specific session instead of an agent
  --window <N>          Time window in days (default: 7, agent-level only)
  --refresh             Bypass cache and force fresh analysis
  --url <url>           Server URL (overrides config)
  -j, --json            Output raw JSON
  -h, --help            Show help

Examples:
  agentlens diagnose my-coding-agent
  agentlens diagnose my-agent --window 14 --refresh
  agentlens diagnose --session sess_abc123 --json`;

export async function runDiagnoseCommand(argv: string[]): Promise<void> {
  const { values, positionals } = parseArgs({
    args: argv,
    options: {
      session: { type: 'string', short: 's' },
      window: { type: 'string', short: 'w' },
      refresh: { type: 'boolean', default: false },
      url: { type: 'string' },
      json: { type: 'boolean', short: 'j', default: false },
      help: { type: 'boolean', short: 'h', default: false },
    },
    allowPositionals: true,
  });

  if (values.help) {
    console.log(HELP);
    return;
  }

  const config = loadConfig();
  const baseUrl = values.url ?? config.url;
  const isSession = !!values.session;

  if (!isSession && positionals.length === 0) {
    console.error('Error: Provide an agent ID or use --session <id>');
    console.log(HELP);
    process.exit(1);
  }

  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (config.apiKey) headers['Authorization'] = `Bearer ${config.apiKey}`;

    let report: Record<string, unknown>;

    if (isSession) {
      const params = new URLSearchParams();
      if (values.refresh) params.set('refresh', 'true');
      const qs = params.toString() ? `?${params}` : '';
      const res = await fetch(`${baseUrl}/api/sessions/${values.session}/diagnose${qs}`, {
        method: 'POST',
        headers,
      });
      report = (await res.json()) as Record<string, unknown>;
    } else {
      const agentId = positionals[0];
      const params = new URLSearchParams();
      if (values.window) params.set('window', values.window);
      if (values.refresh) params.set('refresh', 'true');
      const qs = params.toString() ? `?${params}` : '';
      const res = await fetch(`${baseUrl}/api/agents/${agentId}/diagnose${qs}`, {
        method: 'POST',
        headers,
      });
      report = (await res.json()) as Record<string, unknown>;
    }

    if (values.json) {
      printJson(report);
      return;
    }

    formatReport(report);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`Error: ${msg}`);
    process.exit(1);
  }
}

function formatReport(r: Record<string, unknown>): void {
  const severity = r.severity as string;
  const icon =
    severity === 'critical'
      ? '🔴'
      : severity === 'warning'
        ? '⚠️'
        : severity === 'info'
          ? 'ℹ️'
          : '✅';

  const label = severity.toUpperCase();
  const target = r.type === 'session' ? `Session: ${r.targetId}` : `Agent: ${r.targetId}`;

  console.log('');
  console.log(`╔${'═'.repeat(50)}╗`);
  console.log(`║  ${icon} ${label} — ${target}`.padEnd(51) + '║');
  console.log(`╚${'═'.repeat(50)}╝`);

  if (r.healthScore !== undefined) {
    console.log(`\nHealth Score: ${r.healthScore}/100`);
  }

  console.log(`\nSummary:\n  ${r.summary}`);

  const rootCauses = r.rootCauses as Array<Record<string, unknown>> | undefined;
  if (rootCauses && rootCauses.length > 0) {
    console.log('\nRoot Causes:');
    for (let i = 0; i < rootCauses.length; i++) {
      const rc = rootCauses[i]!;
      const conf = (rc.confidence as number) ?? 0;
      const level = conf >= 0.7 ? 'HIGH' : conf >= 0.4 ? 'MED ' : 'LOW ';
      console.log(`  ${i + 1}. [${level} ${conf.toFixed(2)}] ${rc.description}`);
      console.log(`     Category: ${rc.category}`);
      const evidence = rc.evidence as Array<Record<string, unknown>> | undefined;
      if (evidence && evidence.length > 0) {
        console.log('     Evidence:');
        for (const e of evidence) {
          console.log(`       • ${e.summary}`);
        }
      }
    }
  }

  const recs = r.recommendations as Array<Record<string, unknown>> | undefined;
  if (recs && recs.length > 0) {
    console.log('\nRecommendations:');
    for (const rec of recs) {
      const p = ((rec.priority as string) ?? 'low').toUpperCase();
      console.log(`  ▸ [${p}] ${rec.action}`);
    }
  }

  const meta = r.llmMeta as Record<string, unknown> | undefined;
  if (meta && meta.provider !== 'none') {
    console.log('');
    console.log('─'.repeat(52));
    const cost = (meta.estimatedCostUsd as number) ?? 0;
    console.log(
      `Model: ${meta.model} | Tokens: ${meta.inputTokens} in / ${meta.outputTokens} out | Cost: ~$${cost.toFixed(4)} | ${((meta.latencyMs as number) / 1000).toFixed(1)}s`,
    );
  }

  if (r.source === 'fallback') {
    console.log('\n⚠ AI diagnostics unavailable — showing heuristic analysis');
  }

  console.log('');
}
