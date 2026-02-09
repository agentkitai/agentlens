/**
 * Org Switcher Component (S-7.1)
 *
 * Dropdown in the sidebar/header for switching between organizations.
 * Shows current org name, dropdown of user's orgs, and create org option.
 */

import React, { useState, useRef, useEffect } from 'react';
import { useOrg } from './OrgContext';

export function OrgSwitcher(): React.ReactElement {
  const { currentOrg, orgs, loading, switchOrg, createOrg } = useOrg();
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newOrgName, setNewOrgName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false);
        setCreating(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  if (loading || orgs.length === 0) {
    return <div className="px-3 py-2 text-sm text-gray-400">—</div>;
  }

  const handleCreate = async () => {
    if (!newOrgName.trim()) return;
    setError(null);
    try {
      await createOrg(newOrgName.trim());
      setNewOrgName('');
      setCreating(false);
      setOpen(false);
    } catch (err: any) {
      setError(err.message || 'Failed to create org');
    }
  };

  return (
    <div className="relative" ref={dropdownRef} data-testid="org-switcher">
      {/* Trigger */}
      <button
        type="button"
        className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium
                   text-gray-700 hover:bg-gray-100 transition-colors w-full"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-haspopup="listbox"
      >
        <span className="w-5 h-5 flex items-center justify-center text-base">🏢</span>
        <span className="truncate flex-1 text-left">
          {currentOrg?.name ?? 'Select Org'}
        </span>
        <svg className={`w-4 h-4 transition-transform ${open ? 'rotate-180' : ''}`}
             fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
        </svg>
      </button>

      {/* Dropdown */}
      {open && (
        <div className="absolute left-0 right-0 mt-1 bg-white rounded-lg border border-gray-200
                        shadow-lg z-50 overflow-hidden">
          <ul role="listbox" className="py-1 max-h-60 overflow-auto">
            {orgs.map((org) => (
              <li key={org.id}>
                <button
                  type="button"
                  role="option"
                  aria-selected={org.id === currentOrg?.id}
                  className={`w-full text-left px-4 py-2 text-sm transition-colors
                    ${org.id === currentOrg?.id
                      ? 'bg-brand-50 text-brand-700 font-medium'
                      : 'text-gray-700 hover:bg-gray-50'}`}
                  onClick={() => {
                    if (org.id !== currentOrg?.id) switchOrg(org.id);
                    setOpen(false);
                  }}
                >
                  <div className="flex items-center justify-between">
                    <span className="truncate">{org.name}</span>
                    <span className="text-xs text-gray-400 ml-2">{org.plan}</span>
                  </div>
                </button>
              </li>
            ))}
          </ul>

          <div className="border-t border-gray-200 p-2">
            {creating ? (
              <div className="flex flex-col gap-2">
                <input
                  type="text"
                  value={newOrgName}
                  onChange={(e) => setNewOrgName(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
                  placeholder="Organization name"
                  className="w-full px-3 py-1.5 text-sm border border-gray-300 rounded
                             focus:ring-2 focus:ring-brand-500 focus:border-brand-500"
                  autoFocus
                />
                {error && <p className="text-xs text-red-600">{error}</p>}
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={handleCreate}
                    className="flex-1 px-3 py-1.5 text-sm font-medium text-white bg-brand-600
                               rounded hover:bg-brand-700"
                  >
                    Create
                  </button>
                  <button
                    type="button"
                    onClick={() => { setCreating(false); setError(null); }}
                    className="px-3 py-1.5 text-sm text-gray-600 hover:text-gray-900"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setCreating(true)}
                className="w-full text-left px-2 py-1.5 text-sm text-brand-600
                           hover:text-brand-700 font-medium"
              >
                + Create Organization
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default OrgSwitcher;
