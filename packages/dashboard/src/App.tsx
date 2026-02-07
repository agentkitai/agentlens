import React from 'react';
import { Routes, Route } from 'react-router-dom';
import { Layout } from './components/Layout';
import { Overview } from './pages/Overview';
import { Sessions } from './pages/Sessions';
import { Events } from './pages/Events';
import { Agents } from './pages/Agents';
import Settings from './pages/Settings';
import { SessionDetail as SessionDetailPage } from './pages/SessionDetail';
import { EventsExplorer } from './pages/EventsExplorer';

export function App(): React.ReactElement {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Overview />} />
        <Route path="sessions" element={<Sessions />} />
        <Route path="sessions/:id" element={<SessionDetailPage />} />
        <Route path="events" element={<EventsExplorer />} />
        <Route path="agents" element={<Agents />} />
        <Route path="settings" element={<Settings />} />
      </Route>
    </Routes>
  );
}
