/**
 * [F11-S2] useErrorIndices — Pre-computed error event index array with binary-search helpers
 */
import { useMemo } from 'react';
import type { AgentLensEvent } from '@agentlensai/core';

function isError(ev: AgentLensEvent): boolean {
  return (
    ev.severity === 'error' ||
    ev.severity === 'critical' ||
    ev.eventType === 'tool_error' ||
    ev.eventType === 'alert_triggered'
  );
}

export function useErrorIndices(events: AgentLensEvent[]): number[] {
  return useMemo(
    () =>
      events.reduce<number[]>((acc, ev, i) => {
        if (isError(ev)) acc.push(i);
        return acc;
      }, []),
    [events],
  );
}

/** Find the next error index strictly after `current`. Returns null if none. */
export function findNextError(errorIndices: number[], current: number): number | null {
  let lo = 0;
  let hi = errorIndices.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (errorIndices[mid] <= current) lo = mid + 1;
    else hi = mid;
  }
  return lo < errorIndices.length ? errorIndices[lo] : null;
}

/** Find the previous error index strictly before `current`. Returns null if none. */
export function findPrevError(errorIndices: number[], current: number): number | null {
  let lo = 0;
  let hi = errorIndices.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (errorIndices[mid] < current) lo = mid + 1;
    else hi = mid;
  }
  return lo > 0 ? errorIndices[lo - 1] : null;
}

/** Get the 1-based position of `current` in errorIndices (0 if not an error). */
export function getErrorPosition(errorIndices: number[], current: number): number {
  const idx = errorIndices.indexOf(current);
  return idx >= 0 ? idx + 1 : 0;
}
