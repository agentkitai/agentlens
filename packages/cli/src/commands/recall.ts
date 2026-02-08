/**
 * agentlens recall — Semantic search over agent memory
 */
import { parseArgs } from 'node:util';
import { createClientFromConfig } from '../lib/client.js';
import { printTable, printJson, truncate } from '../lib/output.js';

const HELP = `Usage: agentlens recall <query> [options]

Semantic search over agent memory — find past events, sessions, and lessons by meaning.

Arguments:
  query                  Natural language search query

Options:
  --scope <scope>        Search scope: all|events|sessions|lessons (default: all)
  --limit <n>            Maximum results (default: 10)
  --from <date>          Start date (ISO 8601)
  --to <date>            End date (ISO 8601)
  --agent <id>           Filter by agent ID
  --min-score <n>        Minimum similarity score 0-1 (default: 0)
  --url <url>            Server URL (overrides config)
  -j, --json             Output raw JSON
  -h, --help             Show help

Examples:
  agentlens recall "authentication errors"
  agentlens recall "deployment failures" --scope events --limit 20
  agentlens recall "user onboarding" --from 2026-01-01 --to 2026-02-01
  agentlens recall "auth" --json`;

export async function runRecallCommand(argv: string[]): Promise<void> {
  const { values, positionals } = parseArgs({
    args: argv,
    options: {
      scope: { type: 'string' },
      limit: { type: 'string', short: 'l' },
      from: { type: 'string' },
      to: { type: 'string' },
      agent: { type: 'string', short: 'a' },
      'min-score': { type: 'string' },
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

  const query = positionals[0];
  if (!query) {
    console.error('Error: Query argument is required.\n');
    console.log(HELP);
    process.exit(1);
  }

  const client = createClientFromConfig(values.url);

  const result = await client.recall({
    query,
    scope: values.scope as 'all' | 'events' | 'sessions' | 'lessons' | undefined,
    agentId: values.agent ?? undefined,
    from: values.from ?? undefined,
    to: values.to ?? undefined,
    limit: values.limit ? parseInt(values.limit, 10) : undefined,
    minScore: values['min-score'] ? parseFloat(values['min-score']) : undefined,
  });

  if (values.json) {
    printJson(result);
    return;
  }

  if (result.results.length === 0) {
    console.log(`No results found for "${query}".`);
    return;
  }

  const headers = ['#', 'Source', 'Score', 'Text'];
  const rows = result.results.map((r, i) => [
    String(i + 1),
    r.sourceType,
    `${(r.score * 100).toFixed(1)}%`,
    truncate(r.text.replace(/\n/g, ' '), 80),
  ]);

  printTable(headers, rows);
  console.log(`\n${result.totalResults} result(s) for "${query}".`);
}
