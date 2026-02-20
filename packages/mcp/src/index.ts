#!/usr/bin/env node
/**
 * @agentlensai/mcp — MCP Server Entrypoint (Story 5.1, Feature 10)
 *
 * Starts an MCP server over stdio transport that exposes AgentLens
 * instrumentation tools to MCP-compatible AI agents.
 *
 * Environment variables:
 *   AGENTLENS_URL              — API server base URL (default: http://localhost:3400)
 *   AGENTLENS_API_KEY          — API key for authentication (optional)
 *   AGENTLENS_MCP_TOOLS        — Comma-separated allowlist of tool names to register
 *   AGENTLENS_MCP_TOOLS_EXCLUDE — Comma-separated denylist of tool names to exclude
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { AgentLensTransport } from './transport.js';
import { registerTools } from './tools.js';
import type { ToolRegistrationOptions } from './capabilities.js';

export { AgentLensTransport } from './transport.js';
export { registerTools } from './tools.js';
export type { ToolRegistrationOptions } from './capabilities.js';
export { shouldRegisterTool, TOOL_FEATURE_MAP } from './capabilities.js';
export type { ServerInfo } from './capabilities.js';

function parseEnvList(value: string | undefined): string[] | null {
  if (!value) return null;
  const items = value.split(',').map(s => s.trim()).filter(Boolean);
  return items.length > 0 ? items : null;
}

/**
 * Create and configure the MCP server with auto-discovery (async).
 * Probes server capabilities and conditionally registers tools.
 */
export async function createServer(): Promise<{ mcpServer: McpServer; transport: AgentLensTransport }> {
  const baseUrl = process.env['AGENTLENS_URL'] ?? 'http://localhost:3400';
  const apiKey = process.env['AGENTLENS_API_KEY'];

  const transport = new AgentLensTransport({ baseUrl, apiKey });
  transport.installShutdownHandlers();

  const mcpServer = new McpServer(
    {
      name: 'agentlens',
      version: '0.12.1',
    },
    {
      capabilities: {
        tools: {},
      },
    },
  );

  // Auto-discovery: probe server capabilities
  const serverInfo = await transport.probeCapabilities();

  const allowlist = parseEnvList(process.env['AGENTLENS_MCP_TOOLS']);
  const denylist = parseEnvList(process.env['AGENTLENS_MCP_TOOLS_EXCLUDE']);

  const registrationOpts: ToolRegistrationOptions = { serverInfo, allowlist, denylist };
  registerTools(mcpServer, transport, registrationOpts);

  return { mcpServer, transport };
}

/**
 * Create and configure the MCP server synchronously (no auto-discovery).
 * Registers all tools unconditionally. Backward compatible with old createServer().
 */
export function createServerSync(): { mcpServer: McpServer; transport: AgentLensTransport } {
  const baseUrl = process.env['AGENTLENS_URL'] ?? 'http://localhost:3400';
  const apiKey = process.env['AGENTLENS_API_KEY'];

  const transport = new AgentLensTransport({ baseUrl, apiKey });
  transport.installShutdownHandlers();

  const mcpServer = new McpServer(
    {
      name: 'agentlens',
      version: '0.12.1',
    },
    {
      capabilities: {
        tools: {},
      },
    },
  );

  registerTools(mcpServer, transport);

  return { mcpServer, transport };
}

/**
 * Main entry point — start the MCP server on stdio.
 */
async function main(): Promise<void> {
  const { mcpServer } = await createServer();

  const stdioTransport = new StdioServerTransport();
  await mcpServer.connect(stdioTransport);

  process.stderr.write('AgentLens MCP server running\n');
}

// Run only when executed directly (not when imported as a library)
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const isDirectExecution = (() => {
  try {
    const thisFile = fileURLToPath(import.meta.url);
    const entryFile = process.argv[1] ? resolve(process.argv[1]) : '';
    return thisFile === entryFile;
  } catch {
    return false;
  }
})();

if (isDirectExecution) {
  main().catch((error: unknown) => {
    process.stderr.write(`Fatal error: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  });
}
