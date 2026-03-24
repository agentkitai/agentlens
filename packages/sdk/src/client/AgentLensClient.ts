/**
 * Main AgentLensClient class composing all method groups — extracted from client.ts (cq-003)
 */

import type { AgentLensClientOptions } from './types.js';
import { GuardrailMethods } from './guardrails.js';

/**
 * Typed HTTP client for the AgentLens REST API.
 * Uses native fetch — works in Node.js >= 18 and browsers.
 */
export class AgentLensClient extends GuardrailMethods {
  /**
   * Create a client from environment variables.
   * - `AGENTLENS_SERVER_URL` -> url (default: "http://localhost:3400")
   * - `AGENTLENS_API_KEY` -> apiKey
   * Explicit overrides take priority over env vars.
   */
  static fromEnv(overrides?: Partial<AgentLensClientOptions>): AgentLensClient {
    return new AgentLensClient({
      url: overrides?.url ?? process.env.AGENTLENS_SERVER_URL ?? 'http://localhost:3400',
      apiKey: overrides?.apiKey ?? process.env.AGENTLENS_API_KEY,
      fetch: overrides?.fetch,
    });
  }

  constructor(options: AgentLensClientOptions) {
    super(options);
  }
}
