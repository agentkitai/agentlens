/**
 * agentlens lessons — DEPRECATED
 *
 * Lesson methods have been removed from AgentLens SDK.
 * Use lore-sdk directly: https://github.com/agentkitai/lore
 */

const DEPRECATION_NOTICE = `
⚠️  The "agentlens lessons" command is deprecated.

Lesson management has moved to the standalone Lore SDK.
See: https://github.com/agentkitai/lore

Install:  npm install lore-sdk
`;

export async function lessonsCommand(_args: string[]): Promise<void> {
  console.log(DEPRECATION_NOTICE);
  process.exit(0);
}
