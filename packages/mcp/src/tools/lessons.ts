/**
 * agentlens_lessons MCP Tool (Feature 10, Story 10.11)
 *
 * CRUD for lessons learned. Uses existing transport lesson methods.
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { AgentLensTransport } from '../transport.js';
import { formatApiError } from './error-helpers.js';

export function registerLessonsTool(server: McpServer, transport: AgentLensTransport): void {
  server.tool(
    'agentlens_lessons',
    `Manage lessons learned from agent sessions.

**When to use:** To create, retrieve, update, or delete lessons that capture insights and best practices from past agent runs.

**Actions:**
- \`list\`: List lessons with optional filters
- \`create\`: Create a new lesson
- \`detail\`: Get a single lesson by ID
- \`update\`: Update an existing lesson
- \`delete\`: Delete a lesson

**Example:** agentlens_lessons({ action: "create", title: "Handle timeouts gracefully", body: "Always set a 30s timeout..." })`,
    {
      action: z.enum(['list', 'create', 'detail', 'update', 'delete']).describe('Action to perform'),
      lessonId: z.string().optional().describe('Lesson ID (required for detail/update/delete)'),
      title: z.string().optional().describe('Lesson title (required for create)'),
      body: z.string().optional().describe('Lesson body (required for create)'),
      agentId: z.string().optional().describe('Filter by or assign to agent ID'),
      tags: z.array(z.string()).optional().describe('Tags for the lesson'),
      limit: z.number().optional().describe('Max results (list)'),
    },
    async (params) => {
      try {
        switch (params.action) {
          case 'list': {
            const qp: Record<string, string> = {};
            if (params.agentId) qp.agentId = params.agentId;
            if (params.limit !== undefined) qp.limit = String(params.limit);
            const response = await transport.getLessons(qp);
            if (!response.ok) { const b = await response.text().catch(() => ''); throw new Error(`${response.status}: ${b}`); }
            return { content: [{ type: 'text' as const, text: JSON.stringify(await response.json(), null, 2) }] };
          }

          case 'create': {
            if (!params.title) return { content: [{ type: 'text' as const, text: 'Validation error: "title" is required for create action.' }], isError: true };
            if (!params.body) return { content: [{ type: 'text' as const, text: 'Validation error: "body" is required for create action.' }], isError: true };
            const body: Record<string, unknown> = { title: params.title, body: params.body };
            if (params.agentId) body.agentId = params.agentId;
            if (params.tags) body.tags = params.tags;
            const response = await transport.createLesson(body);
            if (!response.ok) { const b = await response.text().catch(() => ''); throw new Error(`${response.status}: ${b}`); }
            return { content: [{ type: 'text' as const, text: JSON.stringify(await response.json(), null, 2) }] };
          }

          case 'detail': {
            if (!params.lessonId) return { content: [{ type: 'text' as const, text: 'Validation error: "lessonId" is required for detail action.' }], isError: true };
            const response = await transport.getLesson(params.lessonId);
            if (!response.ok) { const b = await response.text().catch(() => ''); throw new Error(`${response.status}: ${b}`); }
            return { content: [{ type: 'text' as const, text: JSON.stringify(await response.json(), null, 2) }] };
          }

          case 'update': {
            if (!params.lessonId) return { content: [{ type: 'text' as const, text: 'Validation error: "lessonId" is required for update action.' }], isError: true };
            const body: Record<string, unknown> = {};
            if (params.title) body.title = params.title;
            if (params.body) body.body = params.body;
            if (params.tags) body.tags = params.tags;
            const response = await transport.updateLesson(params.lessonId, body);
            if (!response.ok) { const b = await response.text().catch(() => ''); throw new Error(`${response.status}: ${b}`); }
            return { content: [{ type: 'text' as const, text: JSON.stringify(await response.json(), null, 2) }] };
          }

          case 'delete': {
            if (!params.lessonId) return { content: [{ type: 'text' as const, text: 'Validation error: "lessonId" is required for delete action.' }], isError: true };
            const response = await transport.deleteLesson(params.lessonId);
            if (!response.ok) { const b = await response.text().catch(() => ''); throw new Error(`${response.status}: ${b}`); }
            return { content: [{ type: 'text' as const, text: `Lesson ${params.lessonId} deleted.` }] };
          }

          default:
            return { content: [{ type: 'text' as const, text: `Unknown action: ${params.action as string}` }], isError: true };
        }
      } catch (error) {
        return formatApiError(error, 'lessons');
      }
    },
  );
}
