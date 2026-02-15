import React, { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react';

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  picture?: string;
}

interface AuthContextValue {
  user: AuthUser | null;
  loading: boolean;
  authMode: 'dual' | 'api-key-only' | null;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue>({
  user: null,
  loading: true,
  authMode: null,
  logout: async () => {},
});

export const useAuth = () => useContext(AuthContext);

const REFRESH_INTERVAL_MS = 12 * 60 * 1000; // 12 minutes

export function AuthProvider({ children }: { children: React.ReactNode }): React.ReactElement {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [authMode, setAuthMode] = useState<'dual' | 'api-key-only' | null>(null);
  const refreshTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchMe = useCallback(async (): Promise<boolean> => {
    try {
      const res = await fetch('/auth/me', { credentials: 'include' });
      if (res.ok) {
        const data = await res.json();
        setUser(data.user ?? data);
        setAuthMode(data.authMode ?? 'dual');
        return true;
      }
      // 401 or other error
      setUser(null);
      // Try to detect auth mode from response
      if (res.status === 401) {
        try {
          const body = await res.json();
          if (body.authMode) setAuthMode(body.authMode);
        } catch { /* ignore */ }
      }
      return false;
    } catch {
      setUser(null);
      return false;
    }
  }, []);

  const startRefreshTimer = useCallback(() => {
    if (refreshTimer.current) clearInterval(refreshTimer.current);
    refreshTimer.current = setInterval(async () => {
      try {
        await fetch('/auth/refresh', { method: 'POST', credentials: 'include' });
      } catch { /* silent */ }
    }, REFRESH_INTERVAL_MS);
  }, []);

  const stopRefreshTimer = useCallback(() => {
    if (refreshTimer.current) {
      clearInterval(refreshTimer.current);
      refreshTimer.current = null;
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const ok = await fetchMe();
      if (!cancelled) {
        setLoading(false);
        if (ok) startRefreshTimer();
      }
    })();
    return () => {
      cancelled = true;
      stopRefreshTimer();
    };
  }, [fetchMe, startRefreshTimer, stopRefreshTimer]);

  const logout = useCallback(async () => {
    stopRefreshTimer();
    try {
      await fetch('/auth/logout', { method: 'POST', credentials: 'include' });
    } catch { /* ignore */ }
    setUser(null);
  }, [stopRefreshTimer]);

  return (
    <AuthContext.Provider value={{ user, loading, authMode, logout }}>
      {children}
    </AuthContext.Provider>
  );
}
