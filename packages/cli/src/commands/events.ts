/**
 * agentlens events — query events
 */
import { parseArgs } from 'node:util';
import type { EventType } from '@agentlensai/sdk';
import { createClientFromConfig } from '../lib/client.js';
import { printTable, printJson, formatTimestamp, truncate } from '../lib/output.js';

export async function runEventsCommand(argv: string[]): Promise<void> {
  const { values } = parseArgs({
    args: argv,
    options: {
      session: { type: 'string', short: 's' },
      type: { type: 'string', short: 't' },
      limit: { type: 'string', short: 'l' },
      json: { type: 'boolean', short: 'j', default: false },
      help: { type: 'boolean', short: 'h', default: false },
    },
    allowPositionals: true,
  });

  if (values.help) {
    console.log(`Usage: agentlens events [options]

Options:
  -s, --session <id>    Filter by session ID
  -t, --type <type>     Filter by event type (e.g. tool_call)
  -l, --limit <n>       Max number of events (default: 20)
  -j, --json            Output raw JSON
  -h, --help            Show help`);
    return;
  }

  const client = createClientFromConfig();
  const limit = values.limit ? parseInt(values.limit, 10) : 20;

  const result = await client.queryEvents({
    sessionId: values.session ?? undefined,
    eventType: (values.type as EventType) ?? undefined,
    limit,
    order: 'desc',
  });

  if (values.json) {
    printJson(result);
    return;
  }

  if (result.events.length === 0) {
    console.log('No events found.');
    return;
  }

  const headers = ['ID', 'Time', 'Session', 'Type', 'Severity', 'Agent'];
  const rows = result.events.map((e) => [
    truncate(e.id, 16),
    formatTimestamp(e.timestamp),
    truncate(e.sessionId, 14),
    e.eventType,
    e.severity,
    truncate(e.agentId, 14),
  ]);

  printTable(headers, rows);
  console.log(`\nShowing ${result.events.length} of ${result.total} events.`);
}
