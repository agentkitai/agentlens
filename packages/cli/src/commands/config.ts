/**
 * agentlens config — get/set configuration
 */
import { loadConfig, saveConfig, maskApiKey } from '../lib/config.js';

export function runConfigCommand(args: string[]): void {
  const subcommand = args[0];

  if (subcommand === 'set') {
    const key = args[1];
    const value = args[2];

    if (!key || !value) {
      console.error('Usage: agentlens config set <key> <value>');
      console.error('Keys: url, api-key');
      process.exit(1);
    }

    const config = loadConfig();

    switch (key) {
      case 'url':
        config.url = value;
        break;
      case 'api-key':
        config.apiKey = value;
        break;
      default:
        console.error(`Unknown config key: ${key}`);
        console.error('Valid keys: url, api-key');
        process.exit(1);
    }

    saveConfig(config);
    console.log(`✓ Set ${key}`);
    return;
  }

  if (subcommand === 'get' || !subcommand) {
    const config = loadConfig();
    console.log('AgentLens CLI Configuration:');
    console.log(`  url:     ${config.url}`);
    console.log(`  api-key: ${config.apiKey ? maskApiKey(config.apiKey) : '(not set)'}`);
    return;
  }

  console.error(`Unknown config subcommand: ${subcommand}`);
  console.error('Usage: agentlens config [get|set <key> <value>]');
  process.exit(1);
}
