/**
 * Cron-driven export scheduler (#151). Runs per-tenant export jobs on a cadence:
 * each run exports the trailing window via runScheduledExport (signed NDJSON/JSON
 * to the configured sink) and fires export.completed. The clock + dispatcher are
 * injectable so a single run is deterministic to test.
 */
import {
  runScheduledExport,
  type ExportSink,
  type ExportFormat,
  type WebhookDispatch,
  type ScheduledExportResult,
} from './scheduled-export.js';
import { createLogger } from './logger.js';

const log = createLogger('ExportScheduler');

export interface ExportJob {
  tenantId: string;
  /** How often to run this job (ms). */
  intervalMs: number;
  /** How far back each run exports (ms; default = intervalMs). */
  windowMs?: number;
  format?: ExportFormat;
  prefix?: string;
  /** Fire export.completed here after each run. */
  webhookUrl?: string;
}

export interface ExportSchedulerDeps {
  sink: ExportSink;
  fetchEvents: (tenantId: string, from: string, to: string) => unknown[];
  /** Clock (ms) — injectable for deterministic tests. */
  now?: () => number;
  /** Webhook dispatcher — injectable for tests. */
  dispatch?: WebhookDispatch;
}

/** Run a single export job for the window ending now. */
export async function runExportJob(job: ExportJob, deps: ExportSchedulerDeps): Promise<ScheduledExportResult> {
  const nowMs = (deps.now ?? Date.now)();
  const to = new Date(nowMs).toISOString();
  const from = new Date(nowMs - (job.windowMs ?? job.intervalMs)).toISOString();
  return runScheduledExport({
    sink: deps.sink,
    tenantId: job.tenantId,
    from,
    to,
    fetchEvents: deps.fetchEvents,
    generatedAt: to,
    ...(job.format ? { format: job.format } : {}),
    ...(job.prefix ? { prefix: job.prefix } : {}),
    ...(job.webhookUrl ? { webhookUrl: job.webhookUrl } : {}),
    ...(deps.dispatch ? { dispatch: deps.dispatch } : {}),
  });
}

/** Start timer-driven export jobs; returns a stop() to clear them. */
export function startExportScheduler(jobs: ExportJob[], deps: ExportSchedulerDeps): { stop: () => void } {
  const timers = jobs.map((job) =>
    setInterval(() => {
      runExportJob(job, deps).catch((e) => log.warn(`scheduled export failed for tenant ${job.tenantId}: ${String(e)}`));
    }, job.intervalMs),
  );
  // Don't keep the process alive just for exports.
  for (const t of timers) if (typeof (t as { unref?: () => void }).unref === 'function') (t as { unref: () => void }).unref();
  return { stop: () => timers.forEach((t) => clearInterval(t)) };
}
