/**
 * Prompt Management MCP Tools (Feature 19 — Story 8)
 *
 * Tools: list, get, create, update, analytics, fingerprints
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { AgentLensTransport } from '../transport.js';
import { formatApiError } from './error-helpers.js';

export function registerPromptsTool(server: McpServer, transport: AgentLensTransport): void {
  server.tool(
    'agentlens_prompts',
    `Manage prompt templates and versions.

**Actions:**
- \`list\`: List prompt templates (optional category, search filters)
- \`get\`: Get a template with all versions by ID
- \`create\`: Create a new prompt template with initial content
- \`update\`: Create a new version of an existing template
- \`analytics\`: Get per-version metrics for a template
- \`fingerprints\`: List auto-discovered prompt fingerprints
- \`environments\`: List configured deploy environments
- \`deploy\`: Deploy a version live in an environment (protected envs need AgentGate approval)
- \`rollback\`: Roll an environment back to an earlier version
- \`deployments\`: List the deploy history (ledger) for a template

**Example:** agentlens_prompts({ action: "deploy", templateId: "...", environment: "staging", versionId: "..." })`,
    {
      action: z
        .enum(['list', 'get', 'create', 'update', 'analytics', 'fingerprints', 'environments', 'deploy', 'rollback', 'deployments'])
        .describe('Action to perform'),
      templateId: z.string().optional().describe('Template ID (for get, update, analytics, deploy, rollback, deployments)'),
      name: z.string().optional().describe('Template name (for create)'),
      content: z.string().optional().describe('Prompt content (for create, update)'),
      description: z.string().optional().describe('Template description (for create)'),
      category: z.string().optional().describe('Category filter or value'),
      variables: z.string().optional().describe('JSON array of variable definitions (for create)'),
      changelog: z.string().optional().describe('Change description (for update)'),
      search: z.string().optional().describe('Name search filter (for list)'),
      from: z.string().optional().describe('Start date ISO (for analytics)'),
      to: z.string().optional().describe('End date ISO (for analytics)'),
      agentId: z.string().optional().describe('Agent ID filter (for fingerprints)'),
      environment: z.string().optional().describe('Environment name (for deploy, rollback, deployments)'),
      versionId: z.string().optional().describe('Version ID to deploy (for deploy)'),
      toVersionId: z.string().optional().describe('Version ID to roll back to (for rollback)'),
    },
    async (params) => {
      try {
        let response: Response;

        switch (params.action) {
          case 'list': {
            const qp: Record<string, string> = {};
            if (params.category) qp.category = params.category;
            if (params.search) qp.search = params.search;
            response = await transport.listPrompts(qp);
            break;
          }
          case 'get': {
            if (!params.templateId) {
              return { content: [{ type: 'text' as const, text: 'Error: templateId is required for get' }], isError: true };
            }
            response = await transport.getPrompt(params.templateId);
            break;
          }
          case 'create': {
            if (!params.name || !params.content) {
              return { content: [{ type: 'text' as const, text: 'Error: name and content are required for create' }], isError: true };
            }
            const createBody: Record<string, unknown> = {
              name: params.name,
              content: params.content,
              description: params.description,
              category: params.category,
            };
            if (params.variables) {
              try {
                createBody.variables = JSON.parse(params.variables);
              } catch {
                return { content: [{ type: 'text' as const, text: 'Error: variables must be valid JSON array' }], isError: true };
              }
            }
            response = await transport.createPrompt(createBody);
            break;
          }
          case 'update': {
            if (!params.templateId || !params.content) {
              return { content: [{ type: 'text' as const, text: 'Error: templateId and content are required for update' }], isError: true };
            }
            response = await transport.createPromptVersion(params.templateId, {
              content: params.content,
              changelog: params.changelog,
            });
            break;
          }
          case 'analytics': {
            if (!params.templateId) {
              return { content: [{ type: 'text' as const, text: 'Error: templateId is required for analytics' }], isError: true };
            }
            const qp: Record<string, string> = {};
            if (params.from) qp.from = params.from;
            if (params.to) qp.to = params.to;
            response = await transport.getPromptAnalytics(params.templateId, qp);
            break;
          }
          case 'fingerprints': {
            const qp: Record<string, string> = {};
            if (params.agentId) qp.agentId = params.agentId;
            response = await transport.getPromptFingerprints(qp);
            break;
          }
          case 'environments': {
            response = await transport.listPromptEnvironments();
            break;
          }
          case 'deploy': {
            if (!params.templateId || !params.environment || !params.versionId) {
              return { content: [{ type: 'text' as const, text: 'Error: templateId, environment and versionId are required for deploy' }], isError: true };
            }
            response = await transport.deployPrompt(params.templateId, { environment: params.environment, versionId: params.versionId });
            break;
          }
          case 'rollback': {
            if (!params.templateId || !params.environment || !params.toVersionId) {
              return { content: [{ type: 'text' as const, text: 'Error: templateId, environment and toVersionId are required for rollback' }], isError: true };
            }
            response = await transport.rollbackPrompt(params.templateId, { environment: params.environment, toVersionId: params.toVersionId });
            break;
          }
          case 'deployments': {
            if (!params.templateId) {
              return { content: [{ type: 'text' as const, text: 'Error: templateId is required for deployments' }], isError: true };
            }
            const qp: Record<string, string> = {};
            if (params.environment) qp.environment = params.environment;
            response = await transport.listPromptDeployments(params.templateId, qp);
            break;
          }
          default:
            return { content: [{ type: 'text' as const, text: `Unknown action: ${params.action as string}` }], isError: true };
        }

        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`${response.status}: ${errorText}`);
        }

        const data = await response.json();
        return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
      } catch (err) {
        return formatApiError(err, 'prompts');
      }
    },
  );
}
