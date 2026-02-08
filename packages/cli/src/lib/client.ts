/**
 * Create an AgentLensClient from CLI config.
 *
 * @param urlOverride - Optional URL that takes precedence over the stored config.
 */
import { AgentLensClient } from '@agentlensai/sdk';
import { loadConfig } from './config.js';

export function createClientFromConfig(urlOverride?: string): AgentLensClient {
  const config = loadConfig();
  return new AgentLensClient({
    url: urlOverride ?? config.url,
    apiKey: config.apiKey,
  });
}
