#!/usr/bin/env node
/**
 * @agentlensai/cli — Command-line interface for AgentLens
 *
 * Uses node:util parseArgs for lightweight argument parsing.
 */

import { runConfigCommand } from './commands/config.js';
import { runContextCommand } from './commands/context.js';
import { runEventsCommand } from './commands/events.js';
import { runGuardrailsCommand } from './commands/guardrails.js';
import { runHealthCommand } from './commands/health.js';
import { runLessonsCommand } from './commands/lessons.js';
import { runLlmCommand } from './commands/llm.js';
import { runOptimizeCommand } from './commands/optimize.js';
import { runRecallCommand } from './commands/recall.js';
import { runReflectCommand } from './commands/reflect.js';
import { runSessionsCommand } from './commands/sessions.js';
import { runTailCommand } from './commands/tail.js';
import { runMigrateCommand } from './commands/migrate.js';

const HELP = `AgentLens CLI — Observability for AI agents

Usage: agentlens <command> [options]

Commands:
  config              Get or set configuration (url, api-key)
  context             Retrieve cross-session context for a topic
  events              Query events
  guardrails          Manage guardrail rules (list, get, create, enable, disable, history, delete)
  health              Agent health scores and trends
  lessons             Manage agent lessons (list, create, get, update, delete, search)
  llm                 LLM call tracking (stats, models, recent)
  migrate             Migrate data between self-hosted and cloud
  optimize            Cost optimization recommendations
  recall              Semantic search over agent memory
  reflect             Pattern analysis across agent sessions
  sessions            List and inspect sessions
  tail                Stream live events (SSE)

Run "agentlens <command> --help" for command-specific help.

Configuration:
  agentlens config set url http://localhost:3400
  agentlens config set api-key als_xxx
  agentlens config get
`;

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const command = args[0];
  const rest = args.slice(1);

  switch (command) {
    case 'config':
      runConfigCommand(rest);
      break;

    case 'context':
      await runContextCommand(rest);
      break;

    case 'events':
      await runEventsCommand(rest);
      break;

    case 'guardrails':
      await runGuardrailsCommand(rest);
      break;

    case 'health':
      await runHealthCommand(rest);
      break;

    case 'lessons':
      await runLessonsCommand(rest);
      break;

    case 'llm':
      await runLlmCommand(rest);
      break;

    case 'migrate':
      await runMigrateCommand(rest);
      break;

    case 'optimize':
      await runOptimizeCommand(rest);
      break;

    case 'recall':
      await runRecallCommand(rest);
      break;

    case 'reflect':
      await runReflectCommand(rest);
      break;

    case 'sessions':
      await runSessionsCommand(rest);
      break;

    case 'tail':
      await runTailCommand(rest);
      break;

    case '--help':
    case '-h':
    case undefined:
      console.log(HELP);
      break;

    case '--version':
    case '-v':
      console.log('0.0.0');
      break;

    default:
      console.error(`Unknown command: ${command}`);
      console.log(HELP);
      process.exit(1);
  }
}

main().catch((err) => {
  if (err && typeof err === 'object' && 'name' in err) {
    const e = err as { name: string; message: string; status?: number };
    // Show friendly error for SDK errors
    if (e.name === 'ConnectionError') {
      console.error(`Error: Cannot connect to AgentLens server.`);
      console.error(`  ${e.message}`);
      console.error(`\nMake sure the server is running and check your config with: agentlens config get`);
    } else if (e.name === 'AuthenticationError') {
      console.error(`Error: Authentication failed.`);
      console.error(`  Set your API key with: agentlens config set api-key <key>`);
    } else {
      console.error(`Error: ${e.message}`);
    }
  } else {
    console.error(`Error: ${err}`);
  }
  process.exit(1);
});
