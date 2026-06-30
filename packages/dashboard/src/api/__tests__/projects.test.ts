// @vitest-environment jsdom
/**
 * Projects API (#231) — getProjects + active-project control.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

function jsonResponse(data: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(data),
    text: () => Promise.resolve(JSON.stringify(data)),
  };
}

let api: typeof import('../projects');

beforeEach(async () => {
  mockFetch.mockReset();
  api = await import('../projects');
});

afterEach(() => {
  api.setActiveProjectId(null);
});

describe('getProjects (#231)', () => {
  it('GETs /api/projects and returns the accessible projects', async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse({ projects: [{ project: { id: 'p1', orgId: 'acme', name: 'support', slug: 'support' }, role: 'member' }] }),
    );
    const projects = await api.getProjects();
    expect(mockFetch.mock.calls[0][0]).toBe('/api/projects');
    expect(projects).toHaveLength(1);
    expect(projects[0]!.project.id).toBe('p1');
    expect(projects[0]!.role).toBe('member');
  });
});

describe('active project selection (#231)', () => {
  it('set/get round-trips and clears', () => {
    api.setActiveProjectId('p2');
    expect(api.getActiveProjectId()).toBe('p2');
    api.setActiveProjectId(null);
    expect(api.getActiveProjectId()).toBeNull();
  });
});
