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

export function App(): React.ReactElement {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Overview />} />
        <Route path="sessions" element={<Sessions />} />
        <Route path="sessions/:id" element={<SessionDetailPage />} />
        <Route path="events" element={<EventsExplorer />} />
        <Route path="agents" element={<Agents />} />
        <Route path="analytics" element={<Analytics />} />
        <Route path="alerts" element={<Alerts />} />
        <Route path="settings" element={<Settings />} />
      </Route>
    </Routes>
  );
}
