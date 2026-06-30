/**
 * Active project selection (#231 / ADR 0002).
 *
 * The dashboard scopes every request to one active project via the X-Project-Id
 * header (resolved + membership-checked server-side by resolveProjectScope). The
 * selection persists across reloads in localStorage.
 */
const STORAGE_KEY = 'agentlens.activeProjectId';

let current: string | null | undefined; // undefined = not yet read from storage

function readStored(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null; // SSR / storage unavailable
  }
}

/** The active project id, or null when none is selected (org-default scope). */
export function getActiveProjectId(): string | null {
  if (current === undefined) current = readStored();
  return current;
}

export function setActiveProjectId(id: string | null): void {
  current = id;
  try {
    if (id) localStorage.setItem(STORAGE_KEY, id);
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore — in-memory value still applies for this session */
  }
}
