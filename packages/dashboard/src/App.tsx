import React, { Suspense } from 'react';
import { ErrorBoundary } from './components/ErrorBoundary';
import { Routes, Route, Navigate } from 'react-router-dom';
import { Layout } from './components/Layout';
import { PageSkeleton } from './components/PageSkeleton';
import { useFeatures } from './hooks/useFeatures';
import { AuthProvider, useAuth } from './context/AuthContext';
import { Login } from './pages/Login';

// Lazy-loaded page components (named exports)
const Overview = React.lazy(() => import('./pages/Overview').then(m => ({ default: m.Overview })));
const Sessions = React.lazy(() => import('./pages/Sessions').then(m => ({ default: m.Sessions })));
const Agents = React.lazy(() => import('./pages/Agents').then(m => ({ default: m.Agents })));
const SessionDetailPage = React.lazy(() => import('./pages/SessionDetail').then(m => ({ default: m.SessionDetail })));
const EventsExplorer = React.lazy(() => import('./pages/EventsExplorer').then(m => ({ default: m.EventsExplorer })));
const Analytics = React.lazy(() => import('./pages/Analytics').then(m => ({ default: m.Analytics })));
const Alerts = React.lazy(() => import('./pages/Alerts').then(m => ({ default: m.Alerts })));
const LlmAnalytics = React.lazy(() => import('./pages/LlmAnalytics').then(m => ({ default: m.LlmAnalytics })));
const Knowledge = React.lazy(() => import('./pages/Knowledge').then(m => ({ default: m.Knowledge })));
const Search = React.lazy(() => import('./pages/Search').then(m => ({ default: m.Search })));
const Insights = React.lazy(() => import('./pages/Insights').then(m => ({ default: m.Insights })));
const HealthOverview = React.lazy(() => import('./pages/HealthOverview').then(m => ({ default: m.HealthOverview })));
const CostOptimization = React.lazy(() => import('./pages/CostOptimization').then(m => ({ default: m.CostOptimization })));
const SessionReplay = React.lazy(() => import('./pages/SessionReplay').then(m => ({ default: m.SessionReplay })));
const Benchmarks = React.lazy(() => import('./pages/Benchmarks').then(m => ({ default: m.Benchmarks })));
const BenchmarkNew = React.lazy(() => import('./pages/BenchmarkNew').then(m => ({ default: m.BenchmarkNew })));
const BenchmarkDetail = React.lazy(() => import('./pages/BenchmarkDetail').then(m => ({ default: m.BenchmarkDetail })));

// Lazy-loaded page components (default exports)
const Settings = React.lazy(() => import('./pages/Settings'));
const Guardrails = React.lazy(() => import('./pages/Guardrails'));
const GuardrailList = React.lazy(() => import('./pages/GuardrailList'));
const GuardrailForm = React.lazy(() => import('./pages/GuardrailForm'));
const GuardrailDetail = React.lazy(() => import('./pages/GuardrailDetail'));
const GuardrailActivity = React.lazy(() => import('./pages/GuardrailActivity'));
const SharingControls = React.lazy(() => import('./pages/SharingControls'));
// CommunityBrowser merged into Knowledge page
const SharingActivity = React.lazy(() => import('./pages/SharingActivity'));
const AgentNetwork = React.lazy(() => import('./pages/AgentNetwork'));
const CapabilityRegistry = React.lazy(() => import('./pages/CapabilityRegistry'));
const DelegationLog = React.lazy(() => import('./pages/DelegationLog'));

// Lazy-loaded cloud components (named exports)
const TeamManagement = React.lazy(() => import('./cloud/TeamManagement').then(m => ({ default: m.TeamManagement })));
const ApiKeyManagement = React.lazy(() => import('./cloud/ApiKeyManagement').then(m => ({ default: m.ApiKeyManagement })));
const UsageDashboard = React.lazy(() => import('./cloud/UsageDashboard').then(m => ({ default: m.UsageDashboard })));

function RequireAuth({ children }: { children: React.ReactElement }): React.ReactElement {
  const { user, loading, authMode } = useAuth();

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-brand-600 border-t-transparent" />
      </div>
    );
  }

  // When SSO is not enabled, skip auth guard
  if (authMode === 'api-key-only') return children;

  if (!user) return <Navigate to="/login" replace />;
  return children;
}

export function App(): React.ReactElement {
  return (
    <AuthProvider>
      <AppRoutes />
    </AuthProvider>
  );
}

function AppRoutes(): React.ReactElement {
  const { lore } = useFeatures();

  return (
    <Routes>
      <Route path="/login" element={<LoginGuard />} />
      <Route element={<RequireAuth><Layout /></RequireAuth>}>
        <Route index element={<Suspense fallback={<PageSkeleton />}><Overview /></Suspense>} />
        <Route path="sessions" element={<Suspense fallback={<PageSkeleton />}><Sessions /></Suspense>} />
        <Route path="sessions/:id" element={<Suspense fallback={<PageSkeleton />}><SessionDetailPage /></Suspense>} />
        <Route path="replay/:sessionId" element={<Suspense fallback={<PageSkeleton />}><SessionReplay /></Suspense>} />
        <Route path="events" element={<Suspense fallback={<PageSkeleton />}><EventsExplorer /></Suspense>} />
        <Route path="agents" element={<Suspense fallback={<PageSkeleton />}><Agents /></Suspense>} />
        <Route path="analytics" element={<Suspense fallback={<PageSkeleton />}><Analytics /></Suspense>} />
        <Route path="llm" element={<Suspense fallback={<PageSkeleton />}><LlmAnalytics /></Suspense>} />
        <Route path="health" element={<Suspense fallback={<PageSkeleton />}><HealthOverview /></Suspense>} />
        <Route path="cost-optimization" element={<Suspense fallback={<PageSkeleton />}><CostOptimization /></Suspense>} />
        <Route path="benchmarks" element={<Suspense fallback={<PageSkeleton />}><Benchmarks /></Suspense>} />
        <Route path="benchmarks/new" element={<Suspense fallback={<PageSkeleton />}><BenchmarkNew /></Suspense>} />
        <Route path="benchmarks/:id" element={<Suspense fallback={<PageSkeleton />}><BenchmarkDetail /></Suspense>} />
        {lore && <Route path="knowledge" element={<Suspense fallback={<PageSkeleton />}><Knowledge /></Suspense>} />}
        <Route path="search" element={<Suspense fallback={<PageSkeleton />}><Search /></Suspense>} />
        <Route path="insights" element={<Suspense fallback={<PageSkeleton />}><Insights /></Suspense>} />
        <Route path="alerts" element={<Suspense fallback={<PageSkeleton />}><Alerts /></Suspense>} />
        <Route path="guardrails" element={<Suspense fallback={<PageSkeleton />}><GuardrailList /></Suspense>} />
        <Route path="guardrails/activity" element={<Suspense fallback={<PageSkeleton />}><GuardrailActivity /></Suspense>} />
        <Route path="guardrails/new" element={<Suspense fallback={<PageSkeleton />}><GuardrailForm /></Suspense>} />
        <Route path="guardrails/:id" element={<Suspense fallback={<PageSkeleton />}><GuardrailDetail /></Suspense>} />
        <Route path="guardrails/:id/edit" element={<Suspense fallback={<PageSkeleton />}><GuardrailForm /></Suspense>} />
        {lore && <Route path="sharing" element={<Suspense fallback={<PageSkeleton />}><SharingControls /></Suspense>} />}
        {lore && <Route path="sharing/activity" element={<Suspense fallback={<PageSkeleton />}><SharingActivity /></Suspense>} />}
        {/* community route redirects handled by Knowledge page */}
        <Route path="network" element={<Navigate to="/agents" replace />} />
        <Route path="capabilities" element={<Navigate to="/agents" replace />} />
        <Route path="delegations" element={<Suspense fallback={<PageSkeleton />}><DelegationLog /></Suspense>} />
        <Route path="team" element={<Suspense fallback={<PageSkeleton />}><TeamManagement /></Suspense>} />
        <Route path="api-keys" element={<Suspense fallback={<PageSkeleton />}><ApiKeyManagement /></Suspense>} />
        <Route path="usage" element={<Suspense fallback={<PageSkeleton />}><UsageDashboard /></Suspense>} />
        <Route path="settings" element={<Suspense fallback={<PageSkeleton />}><Settings /></Suspense>} />
      </Route>
    </Routes>
  );
}

function LoginGuard(): React.ReactElement {
  const { user, loading, authMode } = useAuth();

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-brand-600 border-t-transparent" />
      </div>
    );
  }

  // Already authenticated or SSO not enabled → go to dashboard
  if (user || authMode === 'api-key-only') return <Navigate to="/" replace />;

  return <Login />;
}
