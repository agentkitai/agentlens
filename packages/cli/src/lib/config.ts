/**
 * CLI Configuration — stored in ~/.agentlens/config.json
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

export interface CliConfig {
  url: string;
  apiKey?: string;
}

const CONFIG_DIR = join(homedir(), '.agentlens');
const CONFIG_FILE = join(CONFIG_DIR, 'config.json');

const DEFAULT_CONFIG: CliConfig = {
  url: 'http://localhost:3400',
};

/**
 * Load config from ~/.agentlens/config.json (returns defaults if missing).
 */
export function loadConfig(): CliConfig {
  try {
    const raw = readFileSync(CONFIG_FILE, 'utf-8');
    return { ...DEFAULT_CONFIG, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

/**
 * Save config to ~/.agentlens/config.json.
 */
export function saveConfig(config: CliConfig): void {
  mkdirSync(CONFIG_DIR, { recursive: true });
  writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2) + '\n', 'utf-8');
}

/**
 * Mask an API key for display: show first 8 chars + mask the rest.
 */
export function maskApiKey(key: string): string {
  if (key.length <= 8) return key;
  return key.slice(0, 8) + '•'.repeat(Math.min(key.length - 8, 24));
}
