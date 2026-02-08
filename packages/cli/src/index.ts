#!/usr/bin/env node
/**
 * @agentlens/cli — Command-line interface for AgentLens
 *
 * Uses node:util parseArgs for lightweight argument parsing.
 */

import { runConfigCommand } from './commands/config.js';
import { runEventsCommand } from './commands/events.js';
import { runSessionsCommand } from './commands/sessions.js';
import { runTailCommand } from './commands/tail.js';

const HELP = `AgentLens CLI — Observability for AI agents

Usage: agentlens <command> [options]

Commands:
  config              Get or set configuration (url, api-key)
  events              Query events
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

    case 'events':
      await runEventsCommand(rest);
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
