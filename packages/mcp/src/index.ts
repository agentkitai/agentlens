#!/usr/bin/env node
/**
 * @agentlens/mcp — MCP Server Entrypoint (Story 5.1)
 *
 * Starts an MCP server over stdio transport that exposes AgentLens
 * instrumentation tools to MCP-compatible AI agents.
 *
 * Environment variables:
 *   AGENTLENS_URL     — API server base URL (default: http://localhost:3400)
 *   AGENTLENS_API_KEY — API key for authentication (optional)
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { AgentLensTransport } from './transport.js';
import { registerTools } from './tools.js';

export { AgentLensTransport } from './transport.js';
export { registerTools } from './tools.js';

/**
 * Create and configure the MCP server (exported for testing).
 */
export function createServer(): { mcpServer: McpServer; transport: AgentLensTransport } {
  const baseUrl = process.env['AGENTLENS_URL'] ?? 'http://localhost:3400';
  const apiKey = process.env['AGENTLENS_API_KEY'];

  const transport = new AgentLensTransport({ baseUrl, apiKey });
  transport.installShutdownHandlers();

  const mcpServer = new McpServer(
    {
      name: 'agentlens',
      version: '0.0.0',
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
  const { mcpServer } = createServer();

  const stdioTransport = new StdioServerTransport();
  await mcpServer.connect(stdioTransport);

  // Log to stderr so it doesn't interfere with MCP stdio protocol
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
