/**
 * Create an AgentLensClient from CLI config.
 */
import { AgentLensClient } from '@agentlens/sdk';
import { loadConfig } from './config.js';

export function createClientFromConfig(): AgentLensClient {
  const config = loadConfig();
  return new AgentLensClient({
    url: config.url,
    apiKey: config.apiKey,
  });
}
