import React from 'react';
import { Routes, Route } from 'react-router-dom';
import { Layout } from './components/Layout';
import { Overview } from './pages/Overview';
import { Sessions } from './pages/Sessions';
import { Agents } from './pages/Agents';
import Settings from './pages/Settings';
import { SessionDetail as SessionDetailPage } from './pages/SessionDetail';
import { EventsExplorer } from './pages/EventsExplorer';
import { Analytics } from './pages/Analytics';
import { Alerts } from './pages/Alerts';
import { LlmAnalytics } from './pages/LlmAnalytics';
import { Lessons } from './pages/Lessons';
import { Search } from './pages/Search';
import { Insights } from './pages/Insights';
import { HealthOverview } from './pages/HealthOverview';
import { CostOptimization } from './pages/CostOptimization';
import { SessionReplay } from './pages/SessionReplay';
import { Benchmarks } from './pages/Benchmarks';
import { BenchmarkNew } from './pages/BenchmarkNew';
import { BenchmarkDetail } from './pages/BenchmarkDetail';
import Guardrails from './pages/Guardrails';
import GuardrailList from './pages/GuardrailList';
import GuardrailForm from './pages/GuardrailForm';
import GuardrailDetail from './pages/GuardrailDetail';
import GuardrailActivity from './pages/GuardrailActivity';

export function App(): React.ReactElement {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Overview />} />
        <Route path="sessions" element={<Sessions />} />
        <Route path="sessions/:id" element={<SessionDetailPage />} />
        <Route path="replay/:sessionId" element={<SessionReplay />} />
        <Route path="events" element={<EventsExplorer />} />
        <Route path="agents" element={<Agents />} />
        <Route path="analytics" element={<Analytics />} />
        <Route path="llm" element={<LlmAnalytics />} />
        <Route path="health" element={<HealthOverview />} />
        <Route path="cost-optimization" element={<CostOptimization />} />
        <Route path="benchmarks" element={<Benchmarks />} />
        <Route path="benchmarks/new" element={<BenchmarkNew />} />
        <Route path="benchmarks/:id" element={<BenchmarkDetail />} />
        <Route path="lessons" element={<Lessons />} />
        <Route path="search" element={<Search />} />
        <Route path="insights" element={<Insights />} />
        <Route path="alerts" element={<Alerts />} />
        <Route path="guardrails" element={<GuardrailList />} />
        <Route path="guardrails/activity" element={<GuardrailActivity />} />
        <Route path="guardrails/new" element={<GuardrailForm />} />
        <Route path="guardrails/:id" element={<GuardrailDetail />} />
        <Route path="guardrails/:id/edit" element={<GuardrailForm />} />
        <Route path="settings" element={<Settings />} />
      </Route>
    </Routes>
  );
}
