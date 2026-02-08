/**
 * agentlens context — Cross-session context retrieval
 */
import { parseArgs } from 'node:util';
import { createClientFromConfig } from '../lib/client.js';
import { printJson, truncate, formatTimestamp } from '../lib/output.js';

const HELP = `Usage: agentlens context <topic> [options]

Retrieve cross-session context for a topic — session summaries with relevance scores and related lessons.

Arguments:
  topic                  Topic to retrieve context for

Options:
  --user <id>            Filter by user ID
  --agent <id>           Filter by agent ID
  --limit <n>            Maximum number of sessions (default: 5)
  --url <url>            Server URL (overrides config)
  -j, --json             Output raw JSON
  -h, --help             Show help

Examples:
  agentlens context "database migrations"
  agentlens context "user authentication" --user user123
  agentlens context "API rate limiting" --agent my-agent --limit 3`;

export async function runContextCommand(argv: string[]): Promise<void> {
  const { values, positionals } = parseArgs({
    args: argv,
    options: {
      user: { type: 'string', short: 'u' },
      agent: { type: 'string', short: 'a' },
      limit: { type: 'string', short: 'l' },
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

  const topic = positionals[0];
  if (!topic) {
    console.error('Error: Topic argument is required.\n');
    console.log(HELP);
    process.exit(1);
  }

  const client = createClientFromConfig(values.url);

  const result = await client.getContext({
    topic,
    userId: values.user ?? undefined,
    agentId: values.agent ?? undefined,
    limit: values.limit ? parseInt(values.limit, 10) : undefined,
  });

  if (values.json) {
    printJson(result);
    return;
  }

  console.log(`\nContext for "${result.topic}"\n`);

  if (result.summary) {
    console.log(`Summary: ${result.summary}\n`);
  }

  // Sessions
  if (result.sessions.length > 0) {
    console.log(`Related Sessions (${result.sessions.length} of ${result.totalSessions ?? result.sessions.length}):\n`);

    for (const session of result.sessions) {
      const score = `${(session.relevanceScore * 100).toFixed(1)}%`;
      const started = formatTimestamp(session.startedAt);
      const agent = 'agentId' in session ? (session as { agentId: string }).agentId : '';

      console.log(`  [${score}] Session ${truncate(session.sessionId, 20)}`);
      if (agent) {
        console.log(`          Agent: ${agent}`);
      }
      console.log(`          Started: ${started}`);
      if (session.summary) {
        console.log(`          ${truncate(session.summary, 80)}`);
      }

      if (session.keyEvents && session.keyEvents.length > 0) {
        console.log('          Key events:');
        for (const event of session.keyEvents.slice(0, 3)) {
          console.log(`            - [${event.eventType}] ${truncate(event.summary, 60)}`);
        }
      }
      console.log('');
    }
  } else {
    console.log('No related sessions found.\n');
  }

  // Lessons
  if (result.lessons.length > 0) {
    console.log(`Related Lessons (${result.lessons.length}):\n`);

    for (const lesson of result.lessons) {
      const score = `${(lesson.relevanceScore * 100).toFixed(1)}%`;
      console.log(`  [${score}] ${lesson.title} (${lesson.category})`);
      console.log(`          ${truncate(lesson.content.replace(/\n/g, ' '), 80)}`);
      console.log('');
    }
  } else {
    console.log('No related lessons found.\n');
  }
}
