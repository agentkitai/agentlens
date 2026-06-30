/**
 * Projects API (#231) — the caller's accessible projects + active-project control.
 */
import { request } from './core';

export interface ProjectSummary {
  id: string;
  orgId: string;
  name: string;
  slug: string;
}

export interface ProjectAccess {
  project: ProjectSummary;
  role: string;
}

/**
 * Projects the current user/key can reach (powers the project switcher).
 * Fetched UNSCOPED — it's a membership list, and must succeed even when the
 * persisted active project was revoked (else the switcher can't recover) (#244).
 */
export async function getProjects(): Promise<ProjectAccess[]> {
  const res = await request<{ projects: ProjectAccess[] }>('/api/projects', undefined, { unscoped: true });
  return res.projects;
}

export { getActiveProjectId, setActiveProjectId } from './active-project';
