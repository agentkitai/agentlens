/**
 * Org Context (S-7.1)
 *
 * React context providing current org, list of user's orgs,
 * and a switchOrg function. Consumed by OrgSwitcher and any
 * component that needs org-scoped data.
 */

import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';
import type { CloudOrg } from './api';
import { getMyOrgs, switchOrg as apiSwitchOrg, createOrg as apiCreateOrg } from './api';

export interface OrgContextValue {
  /** Currently active org (null if not loaded yet) */
  currentOrg: CloudOrg | null;
  /** All orgs the user belongs to */
  orgs: CloudOrg[];
  /** Whether orgs are still loading */
  loading: boolean;
  /** Switch to a different org */
  switchOrg: (orgId: string) => Promise<void>;
  /** Create a new org and switch to it */
  createOrg: (name: string) => Promise<CloudOrg>;
  /** Refresh org list */
  refreshOrgs: () => Promise<void>;
}

const OrgContext = createContext<OrgContextValue>({
  currentOrg: null,
  orgs: [],
  loading: true,
  switchOrg: async () => {},
  createOrg: async () => ({} as CloudOrg),
  refreshOrgs: async () => {},
});

export function useOrg(): OrgContextValue {
  return useContext(OrgContext);
}

export function OrgProvider({ children }: { children: React.ReactNode }): React.ReactElement {
  const [orgs, setOrgs] = useState<CloudOrg[]>([]);
  const [currentOrg, setCurrentOrg] = useState<CloudOrg | null>(null);
  const [loading, setLoading] = useState(true);

  const refreshOrgs = useCallback(async () => {
    try {
      const list = await getMyOrgs();
      setOrgs(list);
      // If no current org, select the first one
      setCurrentOrg(prev => prev ?? list[0] ?? null);
    } catch {
      // In self-hosted mode, cloud endpoints won't exist — that's fine
      setOrgs([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshOrgs();
  }, [refreshOrgs]);

  const switchOrg = useCallback(async (orgId: string) => {
    await apiSwitchOrg(orgId);
    const target = orgs.find((o) => o.id === orgId);
    if (target) setCurrentOrg(target);
    // Trigger a full data reload by refreshing the page
    // This ensures all org-scoped data is re-fetched
    window.location.reload();
  }, [orgs]);

  const createOrg = useCallback(async (name: string) => {
    const newOrg = await apiCreateOrg(name);
    setOrgs((prev) => [...prev, newOrg]);
    setCurrentOrg(newOrg);
    return newOrg;
  }, []);

  return (
    <OrgContext.Provider value={{ currentOrg, orgs, loading, switchOrg, createOrg, refreshOrgs }}>
      {children}
    </OrgContext.Provider>
  );
}
