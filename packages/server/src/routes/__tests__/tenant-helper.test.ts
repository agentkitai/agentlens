/**
 * tenant-helper project/org seam (#228 — ADR 0002).
 * getTenantId returns the PROJECT id (the isolation key); getOrgId returns the org.
 */
import { describe, it, expect } from 'vitest';
import { getTenantId, getOrgId } from '../tenant-helper.js';

// Minimal Hono-context stand-in: only `get(key)` is used by these helpers.
function ctx(vars: Record<string, unknown>) {
  return { get: (k: string) => vars[k] } as unknown as Parameters<typeof getTenantId>[0];
}

describe('tenant-helper project/org seam (#228)', () => {
  it('getTenantId returns the project id (the isolation key)', () => {
    expect(getTenantId(ctx({ auth: { projectId: 'proj-a', orgId: 'acme' } }))).toBe('proj-a');
  });

  it('getOrgId returns the org (the grouping/billing tier), defaulting to "default"', () => {
    expect(getOrgId(ctx({ auth: { projectId: 'proj-a', orgId: 'acme' } }))).toBe('acme');
    expect(getOrgId(ctx({}))).toBe('default');
  });

  it('getTenantId falls back to orgId, then legacy apiKey.tenantId, when projectId is absent', () => {
    expect(getTenantId(ctx({ auth: { orgId: 'legacy-org' } }))).toBe('legacy-org');
    expect(getTenantId(ctx({ apiKey: { tenantId: 'legacy-tenant' } }))).toBe('legacy-tenant');
  });

  it('getTenantId fails closed (401) with no auth context', () => {
    expect(() => getTenantId(ctx({}))).toThrow();
  });
});
