/**
 * agentlens tail — stream live events via SSE
 *
 * Connects to the /api/stream SSE endpoint. The endpoint is being built
 * in Epic 14 in parallel — the command structure is ready for it.
 */
import { parseArgs } from 'node:util';
import { loadConfig } from '../lib/config.js';
import { formatTimestamp, truncate } from '../lib/output.js';

export async function runTailCommand(argv: string[]): Promise<void> {
  const { values } = parseArgs({
    args: argv,
    options: {
      session: { type: 'string', short: 's' },
      type: { type: 'string', short: 't' },
      json: { type: 'boolean', short: 'j', default: false },
      help: { type: 'boolean', short: 'h', default: false },
    },
    allowPositionals: false,
  });

  if (values.help) {
    console.log(`Usage: agentlens tail [options]

Stream live events as they arrive.

Options:
  -s, --session <id>    Filter by session ID
  -t, --type <type>     Filter by event type
  -j, --json            Output raw JSON per event
  -h, --help            Show help

Press Ctrl+C to stop.`);
    return;
  }

  const config = loadConfig();
  const baseUrl = config.url.replace(/\/+$/, '');

  // Build SSE URL with filters
  const params = new URLSearchParams();
  if (values.session) params.set('sessionId', values.session);
  if (values.type) params.set('eventType', values.type);

  const sseUrl = `${baseUrl}/api/stream${params.toString() ? '?' + params.toString() : ''}`;

  const headers: Record<string, string> = {
    'Accept': 'text/event-stream',
  };
  if (config.apiKey) {
    headers['Authorization'] = `Bearer ${config.apiKey}`;
  }

  console.log(`Connecting to ${baseUrl}...`);

  // Use native fetch with streaming (works in Node.js ≥ 18)
  let response: Response;
  try {
    response = await fetch(sseUrl, {
      headers,
      signal: createAbortOnSigint(),
    });
  } catch (err) {
    if ((err as Error).name === 'AbortError') {
      console.log('\nDisconnected.');
      return;
    }
    console.error(`Failed to connect: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    console.error(`Server returned ${response.status}: ${text}`);
    process.exit(1);
  }

  if (!response.body) {
    console.error('No response body (streaming not supported)');
    process.exit(1);
  }

  console.log('Connected. Streaming events (Ctrl+C to stop)...\n');

  // Parse SSE stream
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    for await (const chunk of response.body as AsyncIterable<Uint8Array>) {
      buffer += decoder.decode(chunk, { stream: true });

      // Process complete SSE messages (double newline separated)
      const messages = buffer.split('\n\n');
      buffer = messages.pop() ?? '';

      for (const msg of messages) {
        processSSEMessage(msg, values.json ?? false);
      }
    }
  } catch (err) {
    if ((err as Error).name === 'AbortError') {
      // Normal Ctrl+C
    } else {
      console.error(`\nStream error: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  console.log('\nDisconnected.');
}

/**
 * Parse and display a single SSE message.
 */
function processSSEMessage(raw: string, jsonOutput: boolean): void {
  let eventType = 'message';
  let data = '';

  for (const line of raw.split('\n')) {
    if (line.startsWith('event:')) {
      eventType = line.slice(6).trim();
    } else if (line.startsWith('data:')) {
      data += line.slice(5).trim();
    }
  }

  // Skip heartbeats
  if (eventType === 'heartbeat') return;
  if (!data) return;

  if (jsonOutput) {
    console.log(data);
    return;
  }

  // Try to parse as event JSON
  try {
    const event = JSON.parse(data) as Record<string, unknown>;
    const ts = typeof event['timestamp'] === 'string' ? formatTimestamp(event['timestamp']) : '';
    const type = event['eventType'] ?? eventType;
    const severity = event['severity'] ?? 'info';
    const session = truncate(String(event['sessionId'] ?? ''), 14);
    const agent = truncate(String(event['agentId'] ?? ''), 14);

    console.log(`[${ts}] ${String(type).padEnd(16)} ${String(severity).padEnd(8)} ${session}  ${agent}`);
  } catch {
    // Raw message
    console.log(`[${eventType}] ${truncate(data, 100)}`);
  }
}

/**
 * Create an AbortSignal that triggers on SIGINT (Ctrl+C).
 */
function createAbortOnSigint(): AbortSignal {
  const controller = new AbortController();
  const handler = () => {
    controller.abort();
    process.removeListener('SIGINT', handler);
  };
  process.on('SIGINT', handler);
  return controller.signal;
}
