/**
 * agentlens_learn MCP Tool (Story 3.3)
 *
 * Provides lesson CRUD operations via a single tool with an `action` parameter.
 * Actions: save, list, get, update, delete, search
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { AgentLensTransport } from '../transport.js';

export function registerLearnTool(server: McpServer, transport: AgentLensTransport): void {
  server.tool(
    'agentlens_learn',
    'Manage agent lessons — save, retrieve, update, delete, or search distilled insights and knowledge.',
    {
      action: z.enum(['save', 'list', 'get', 'update', 'delete', 'search']).describe(
        'Operation to perform: save (create new lesson), list (list lessons), get (get by ID), update (update lesson), delete (archive lesson), search (text search)',
      ),
      // Fields for save/update
      title: z.string().optional().describe('Lesson title (required for save)'),
      content: z.string().optional().describe('Lesson content (required for save)'),
      category: z.string().optional().describe('Category for the lesson (default: general)'),
      importance: z.enum(['low', 'normal', 'high', 'critical']).optional().describe('Importance level (default: normal)'),
      agentId: z.string().optional().describe('Agent ID to scope the lesson to'),
      context: z.record(z.unknown()).optional().describe('Additional context metadata'),
      sourceSessionId: z.string().optional().describe('Session ID where this lesson originated'),
      sourceEventId: z.string().optional().describe('Event ID where this lesson originated'),
      // Fields for get/update/delete
      id: z.string().optional().describe('Lesson ID (required for get, update, delete)'),
      // Fields for list/search
      search: z.string().optional().describe('Search query text (for search action)'),
      limit: z.number().optional().describe('Max results to return (default: 10)'),
      offset: z.number().optional().describe('Offset for pagination'),
      includeArchived: z.boolean().optional().describe('Include archived lessons in results'),
    },
    async (args) => {
      try {
        switch (args.action) {
          case 'save':
            return await handleSave(transport, args);
          case 'list':
            return await handleList(transport, args);
          case 'get':
            return await handleGet(transport, args);
          case 'update':
            return await handleUpdate(transport, args);
          case 'delete':
            return await handleDelete(transport, args);
          case 'search':
            return await handleSearch(transport, args);
          default:
            return {
              content: [{ type: 'text' as const, text: `Unknown action: ${args.action}` }],
              isError: true,
            };
        }
      } catch (error) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `Error in agentlens_learn: ${error instanceof Error ? error.message : 'Unknown error'}`,
            },
          ],
          isError: true,
        };
      }
    },
  );
}

// ─── Action Handlers ───────────────────────────────────────────────

async function handleSave(
  transport: AgentLensTransport,
  args: Record<string, unknown>,
) {
  if (!args.title || typeof args.title !== 'string') {
    return {
      content: [{ type: 'text' as const, text: 'Error: title is required for save action' }],
      isError: true,
    };
  }
  if (!args.content || typeof args.content !== 'string') {
    return {
      content: [{ type: 'text' as const, text: 'Error: content is required for save action' }],
      isError: true,
    };
  }

  const body: Record<string, unknown> = {
    title: args.title,
    content: args.content,
  };
  if (args.category !== undefined) body.category = args.category;
  if (args.importance !== undefined) body.importance = args.importance;
  if (args.agentId !== undefined) body.agentId = args.agentId;
  if (args.context !== undefined) body.context = args.context;
  if (args.sourceSessionId !== undefined) body.sourceSessionId = args.sourceSessionId;
  if (args.sourceEventId !== undefined) body.sourceEventId = args.sourceEventId;

  const response = await transport.createLesson(body);
  if (!response.ok) {
    const text = await response.text().catch(() => 'Unknown error');
    return {
      content: [{ type: 'text' as const, text: `Error saving lesson: ${response.status}: ${text}` }],
      isError: true,
    };
  }

  const lesson = await response.json();
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(lesson) }],
  };
}

async function handleList(
  transport: AgentLensTransport,
  args: Record<string, unknown>,
) {
  const params: Record<string, string> = {};
  if (args.category) params.category = String(args.category);
  if (args.agentId) params.agentId = String(args.agentId);
  if (args.importance) params.importance = String(args.importance);
  if (args.limit !== undefined) params.limit = String(args.limit);
  if (args.offset !== undefined) params.offset = String(args.offset);
  if (args.includeArchived) params.includeArchived = 'true';

  const response = await transport.getLessons(params);
  if (!response.ok) {
    const text = await response.text().catch(() => 'Unknown error');
    return {
      content: [{ type: 'text' as const, text: `Error listing lessons: ${response.status}: ${text}` }],
      isError: true,
    };
  }

  const data = await response.json() as { lessons: Array<{ id: string; title: string; category: string; importance: string }>; total: number };
  const summaries = data.lessons.map(
    (l) => `[${l.id}] (${l.category}/${l.importance}) ${l.title}`,
  );

  return {
    content: [
      {
        type: 'text' as const,
        text: data.lessons.length === 0
          ? 'No lessons found.'
          : `Found ${data.total} lesson(s):\n${summaries.join('\n')}`,
      },
    ],
  };
}

async function handleGet(
  transport: AgentLensTransport,
  args: Record<string, unknown>,
) {
  if (!args.id || typeof args.id !== 'string') {
    return {
      content: [{ type: 'text' as const, text: 'Error: id is required for get action' }],
      isError: true,
    };
  }

  const response = await transport.getLesson(args.id);
  if (!response.ok) {
    if (response.status === 404) {
      return {
        content: [{ type: 'text' as const, text: `Lesson not found: ${args.id}` }],
        isError: true,
      };
    }
    const text = await response.text().catch(() => 'Unknown error');
    return {
      content: [{ type: 'text' as const, text: `Error getting lesson: ${response.status}: ${text}` }],
      isError: true,
    };
  }

  const lesson = await response.json();
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(lesson) }],
  };
}

async function handleUpdate(
  transport: AgentLensTransport,
  args: Record<string, unknown>,
) {
  if (!args.id || typeof args.id !== 'string') {
    return {
      content: [{ type: 'text' as const, text: 'Error: id is required for update action' }],
      isError: true,
    };
  }

  const body: Record<string, unknown> = {};
  if (args.title !== undefined) body.title = args.title;
  if (args.content !== undefined) body.content = args.content;
  if (args.category !== undefined) body.category = args.category;
  if (args.importance !== undefined) body.importance = args.importance;
  if (args.agentId !== undefined) body.agentId = args.agentId;
  if (args.context !== undefined) body.context = args.context;

  const response = await transport.updateLesson(args.id, body);
  if (!response.ok) {
    if (response.status === 404) {
      return {
        content: [{ type: 'text' as const, text: `Lesson not found: ${args.id}` }],
        isError: true,
      };
    }
    const text = await response.text().catch(() => 'Unknown error');
    return {
      content: [{ type: 'text' as const, text: `Error updating lesson: ${response.status}: ${text}` }],
      isError: true,
    };
  }

  const lesson = await response.json();
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(lesson) }],
  };
}

async function handleDelete(
  transport: AgentLensTransport,
  args: Record<string, unknown>,
) {
  if (!args.id || typeof args.id !== 'string') {
    return {
      content: [{ type: 'text' as const, text: 'Error: id is required for delete action' }],
      isError: true,
    };
  }

  const response = await transport.deleteLesson(args.id);
  if (!response.ok) {
    if (response.status === 404) {
      return {
        content: [{ type: 'text' as const, text: `Lesson not found: ${args.id}` }],
        isError: true,
      };
    }
    const text = await response.text().catch(() => 'Unknown error');
    return {
      content: [{ type: 'text' as const, text: `Error deleting lesson: ${response.status}: ${text}` }],
      isError: true,
    };
  }

  return {
    content: [{ type: 'text' as const, text: `Lesson ${args.id} archived successfully.` }],
  };
}

async function handleSearch(
  transport: AgentLensTransport,
  args: Record<string, unknown>,
) {
  if (!args.search || typeof args.search !== 'string') {
    return {
      content: [{ type: 'text' as const, text: 'Error: search is required for search action' }],
      isError: true,
    };
  }

  const params: Record<string, string> = {
    search: args.search,
  };
  if (args.agentId) params.agentId = String(args.agentId);
  if (args.category) params.category = String(args.category);
  if (args.limit !== undefined) params.limit = String(args.limit);
  if (args.offset !== undefined) params.offset = String(args.offset);
  if (args.includeArchived) params.includeArchived = 'true';

  const response = await transport.getLessons(params);
  if (!response.ok) {
    const text = await response.text().catch(() => 'Unknown error');
    return {
      content: [{ type: 'text' as const, text: `Error searching lessons: ${response.status}: ${text}` }],
      isError: true,
    };
  }

  const data = await response.json() as { lessons: Array<{ id: string; title: string; category: string; importance: string; content: string }>; total: number };
  const summaries = data.lessons.map(
    (l) => `[${l.id}] (${l.category}/${l.importance}) ${l.title}\n  ${l.content.slice(0, 100)}${l.content.length > 100 ? '...' : ''}`,
  );

  return {
    content: [
      {
        type: 'text' as const,
        text: data.lessons.length === 0
          ? `No lessons found matching "${args.search}".`
          : `Found ${data.total} lesson(s) matching "${args.search}":\n${summaries.join('\n')}`,
      },
    ],
  };
}
