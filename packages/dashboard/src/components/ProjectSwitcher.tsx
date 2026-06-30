/**
 * Project switcher (#244) — picks the active project; the selection persists in
 * the active-project module and rides on X-Project-Id (set in api/core.ts).
 *
 * Mirrors OrgSwitcher/TimeRangePicker: local open-state + outside-click/Escape,
 * brand-* Tailwind. On select (and on default/recover) we persist + reload — the
 * proven OrgContext.switchOrg pattern — so every useApi call refetches under the
 * new scope (the dashboard has no react-query / query invalidation to lean on,
 * and reload also wipes useApi's in-memory cache so no prior-scope data bleeds).
 */
import { useEffect, useRef, useState } from 'react';
import { getProjects, getActiveProjectId, setActiveProjectId, type ProjectAccess } from '../api/projects';

const MENU_ID = 'project-switcher-menu';

export function ProjectSwitcher() {
  const [projects, setProjects] = useState<ProjectAccess[]>([]);
  const [activeId, setActiveId] = useState<string | null>(getActiveProjectId());
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    // getProjects() is unscoped (api/projects.ts), so it succeeds even when the
    // persisted active project was revoked — letting us detect + recover here.
    getProjects()
      .then((list) => {
        if (cancelled) return;
        setProjects(list);
        const active = getActiveProjectId();
        const valid = !!active && list.some((p) => p.project.id === active);
        if (!valid && list.length > 0) {
          // No active project, or the persisted one is no longer accessible →
          // default to the first accessible project.
          setActiveProjectId(list[0]!.project.id);
          setActiveId(list[0]!.project.id);
          // Reload when a stale scope must be dropped (the current page's requests
          // already 403'd / used the wrong scope), or when the visible switcher
          // must match on-screen data. A silent single-project default needs neither.
          if (active || list.length > 1) window.location.reload();
        }
      })
      .catch(() => {
        /* no projects API (e.g. single-tenant OSS) — switcher stays hidden */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    if (open) {
      document.addEventListener('mousedown', onDown);
      document.addEventListener('keydown', onKey);
    }
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  // Nothing to switch between — hide for single/no-project users.
  if (projects.length <= 1) return null;

  const current = projects.find((p) => p.project.id === activeId) ?? projects[0]!;

  function select(id: string) {
    setOpen(false);
    if (id === activeId) return;
    setActiveProjectId(id);
    window.location.reload();
  }

  return (
    <div ref={ref} className="relative mt-2">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-controls={MENU_ID}
        className="inline-flex w-full items-center justify-between gap-1.5 rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
      >
        <span className="truncate">{current.project.name}</span>
        <svg
          className={`w-4 h-4 shrink-0 text-gray-400 transition-transform ${open ? 'rotate-180' : ''}`}
          fill="none"
          viewBox="0 0 24 24"
          strokeWidth={2}
          stroke="currentColor"
          aria-hidden="true"
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
        </svg>
      </button>
      {open && (
        <div id={MENU_ID} role="menu" className="absolute left-0 right-0 z-50 mt-1 rounded-lg border border-gray-200 bg-white shadow-lg py-1">
          {projects.map((p) => (
            <button
              key={p.project.id}
              type="button"
              role="menuitemradio"
              aria-checked={p.project.id === current.project.id}
              onClick={() => select(p.project.id)}
              className={`block w-full px-4 py-2 text-left text-sm hover:bg-gray-50 transition-colors ${
                p.project.id === current.project.id ? 'bg-brand-50 text-brand-700 font-medium' : 'text-gray-700'
              }`}
            >
              {p.project.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
