/**
 * Alert Grouping Buffer (Feature 12, Story 12.7)
 *
 * Groups alerts from the same rule within a configurable window to
 * prevent notification storms.
 */

import type { NotificationPayload } from '@agentlensai/core';
import { createLogger } from '../logger.js';

const log = createLogger('GroupingBuffer');

const DEFAULT_WINDOW_MS = 5 * 60 * 1000; // 5 minutes

interface GroupEntry {
  entries: NotificationPayload[];
  firstSeen: number;
  timer: ReturnType<typeof setTimeout>;
  sent: boolean; // whether the first alert was already dispatched
}

export type FlushCallback = (payload: NotificationPayload, groupCount: number) => Promise<void>;

export class GroupingBuffer {
  private groups = new Map<string, GroupEntry>();
  private windowMs: number;

  constructor(
    private onFlush: FlushCallback,
    windowMs?: number,
  ) {
    this.windowMs = windowMs ?? (parseInt(process.env['ALERT_GROUP_WINDOW_MS'] ?? '', 10) || DEFAULT_WINDOW_MS);
  }

  /**
   * Submit an alert. Returns true if the alert should be sent immediately
   * (first in its group), false if it was grouped (suppressed).
   */
  submit(ruleId: string, payload: NotificationPayload): boolean {
    const existing = this.groups.get(ruleId);

    if (!existing) {
      // First alert for this rule — send immediately, start group window
      const timer = setTimeout(() => this.flush(ruleId), this.windowMs);
      this.groups.set(ruleId, {
        entries: [payload],
        firstSeen: Date.now(),
        timer,
        sent: true,
      });
      return true; // send immediately
    }

    // Subsequent alert — group it
    existing.entries.push(payload);
    return false; // suppressed
  }

  private async flush(ruleId: string): Promise<void> {
    const group = this.groups.get(ruleId);
    this.groups.delete(ruleId);
    if (!group) return;

    // If more than 1 entry, send a grouped summary
    if (group.entries.length > 1) {
      const latest = group.entries[group.entries.length - 1]!;
      const summaryPayload: NotificationPayload = {
        ...latest,
        title: `[Grouped] ${latest.title}`,
        message: `${latest.message} (${group.entries.length} occurrences in ${Math.round(this.windowMs / 60000)}m window)`,
        metadata: { ...latest.metadata, groupCount: group.entries.length },
      };

      try {
        await this.onFlush(summaryPayload, group.entries.length);
      } catch (err) {
        log.error(`Failed to flush grouped alert for rule ${ruleId}: ${err}`);
      }
    }
  }

  /** Stop all timers (for cleanup) */
  stop(): void {
    for (const [, group] of this.groups) {
      clearTimeout(group.timer);
    }
    this.groups.clear();
  }

  /** Get the current window in ms */
  getWindowMs(): number {
    return this.windowMs;
  }
}
