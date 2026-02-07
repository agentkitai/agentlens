/**
 * Stub for node:crypto in browser builds.
 * @agentlens/core exports hash utilities that use node:crypto,
 * but the dashboard only needs types + constants from core.
 * This stub prevents the build from failing on the import.
 */

export function createHash(): never {
  throw new Error('node:crypto is not available in browser');
}
