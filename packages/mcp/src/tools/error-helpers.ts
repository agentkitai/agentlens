/**
 * Error helpers for MCP tools — consistent error formatting (Feature 10, Story 10.5)
 *
 * Detects 404/501 responses and appends upgrade suggestion per R13.
 */

export type ToolResult = {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
};

export function formatApiError(error: unknown, featureName: string): ToolResult {
  const message = error instanceof Error ? error.message : String(error);
  const is404 = message.includes('404');
  const is501 = message.includes('501');

  let text = `Error: ${message}`;
  if (is404 || is501) {
    text += `\n\nThis feature may require a newer AgentLens server version. ` +
      `The "${featureName}" API endpoint was not found.`;
  }

  return { content: [{ type: 'text' as const, text }], isError: true };
}
