/**
 * Events page wrapper (Story 8.1)
 *
 * Re-exports EventsExplorer as the Events route component.
 */

import React from 'react';
import { EventsExplorer } from './EventsExplorer';

export function Events(): React.ReactElement {
  return <EventsExplorer />;
}
