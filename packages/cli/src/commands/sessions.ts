/**
 * agentlens sessions — list and inspect sessions
 */
import { parseArgs } from 'node:util';
import type { SessionStatus } from '@agentlensai/sdk';
import { createClientFromConfig } from '../lib/client.js';
import {
  printTable,
  printJson,
  formatTimestamp,
  formatDuration,
  truncate,
} from '../lib/output.js';

export async function runSessionsCommand(argv: string[]): Promise<void> {
  const { values, positionals } = parseArgs({
    args: argv,
    options: {
      status: { type: 'string' },
      agent: { type: 'string', short: 'a' },
      limit: { type: 'string', short: 'l' },
      json: { type: 'boolean', short: 'j', default: false },
      help: { type: 'boolean', short: 'h', default: false },
    },
    allowPositionals: true,
  });

  // agentlens sessions show <id>
  if (positionals[0] === 'show') {
    const sessionId = positionals[1];
    if (!sessionId) {
      console.error('Usage: agentlens sessions show <session-id>');
      process.exit(1);
    }
    await showSession(sessionId, values.json ?? false);
    return;
  }

  if (values.help) {
    console.log(`Usage: agentlens sessions [options]
       agentlens sessions show <id>

Options:
  --status <status>   Filter by status (active, completed, error)
  -a, --agent <id>    Filter by agent ID
  -l, --limit <n>     Max number of sessions (default: 20)
  -j, --json          Output raw JSON
  -h, --help          Show help`);
    return;
  }

  const client = createClientFromConfig();
  const limit = values.limit ? parseInt(values.limit, 10) : 20;

  const result = await client.getSessions({
    status: (values.status as SessionStatus) ?? undefined,
    agentId: values.agent ?? undefined,
    limit,
  });

  if (values.json) {
    printJson(result);
    return;
  }

  if (result.sessions.length === 0) {
    console.log('No sessions found.');
    return;
  }

  const headers = ['ID', 'Agent', 'Status', 'Started', 'Duration', 'Events', 'Errors'];
  const rows = result.sessions.map((s) => [
    truncate(s.id, 16),
    truncate(s.agentId, 14),
    s.status,
    formatTimestamp(s.startedAt),
    formatDuration(s.startedAt, s.endedAt),
    String(s.eventCount),
    String(s.errorCount),
  ]);

  printTable(headers, rows);
  console.log(`\nShowing ${result.sessions.length} of ${result.total} sessions.`);
}

async function showSession(sessionId: string, json: boolean): Promise<void> {
  const client = createClientFromConfig();

  const [session, timeline] = await Promise.all([
    client.getSession(sessionId),
    client.getSessionTimeline(sessionId),
  ]);

  if (json) {
    printJson({ session, timeline });
    return;
  }

  console.log(`\nSession: ${session.id}`);
  console.log(`  Agent:    ${session.agentId}${session.agentName ? ` (${session.agentName})` : ''}`);
  console.log(`  Status:   ${session.status}`);
  console.log(`  Started:  ${formatTimestamp(session.startedAt)}`);
  console.log(`  Duration: ${formatDuration(session.startedAt, session.endedAt)}`);
  console.log(`  Events:   ${session.eventCount} total, ${session.toolCallCount} tool calls, ${session.errorCount} errors`);
  if (session.totalCostUsd > 0) {
    console.log(`  Cost:     $${session.totalCostUsd.toFixed(4)}`);
  }
  console.log(`  Chain:    ${timeline.chainValid ? '✓ valid' : '✗ broken'}`);

  if (timeline.events.length > 0) {
    console.log(`\nTimeline (${timeline.events.length} events):`);
    const headers = ['Time', 'Type', 'Severity', 'Summary'];
    const rows = timeline.events.map((e) => [
      formatTimestamp(e.timestamp),
      e.eventType,
      e.severity,
      truncate(summarizePayload(e.eventType, e.payload), 40),
    ]);
    printTable(headers, rows);
  }
}

function summarizePayload(eventType: string, payload: unknown): string {
  if (!payload || typeof payload !== 'object') return '';
  const p = payload as Record<string, unknown>;

  switch (eventType) {
    case 'tool_call':
      return `${p['toolName'] ?? 'unknown'}()`;
    case 'tool_response':
      return `${p['toolName'] ?? ''} → ${p['durationMs'] ?? '?'}ms`;
    case 'tool_error':
      return `${p['toolName'] ?? ''}: ${p['error'] ?? 'error'}`;
    case 'session_started':
      return p['agentName'] ? String(p['agentName']) : '';
    case 'session_ended':
      return String(p['reason'] ?? 'ended');
    default:
      return '';
  }
}
