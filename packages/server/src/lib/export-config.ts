/**
 * Scheduled-export configuration (#151). Parses the `SCHEDULED_EXPORTS` env JSON
 * into a sink + a list of per-tenant jobs, and builds the configured ExportSink.
 *
 * Example SCHEDULED_EXPORTS:
 *   {"sink":{"type":"s3","bucket":"exports","prefix":"agentlens"},
 *    "jobs":[{"tenantId":"default","intervalMs":3600000,"format":"ndjson",
 *             "webhookUrl":"https://hooks.example.com/export"}]}
 */
import { FilesystemSink, type ExportSink } from './scheduled-export.js';
import { s3Sink, gcsSink, azureSink } from './sinks/blob-sink.js';
import type { ExportJob } from './export-scheduler.js';

export type SinkConfig =
  | { type: 'filesystem'; dir: string }
  | { type: 's3'; bucket: string; prefix?: string; region?: string; endpoint?: string }
  | { type: 'gcs'; bucket: string; prefix?: string; projectId?: string; keyFilename?: string }
  | { type: 'azure'; container: string; prefix?: string; connectionString?: string };

export function sinkFromConfig(cfg: SinkConfig): ExportSink {
  switch (cfg.type) {
    case 'filesystem':
      return new FilesystemSink(cfg.dir);
    case 's3':
      return s3Sink(cfg.bucket, {
        ...(cfg.prefix ? { prefix: cfg.prefix } : {}),
        ...(cfg.region ? { region: cfg.region } : {}),
        ...(cfg.endpoint ? { endpoint: cfg.endpoint } : {}),
      });
    case 'gcs':
      return gcsSink(cfg.bucket, {
        ...(cfg.prefix ? { prefix: cfg.prefix } : {}),
        ...(cfg.projectId ? { projectId: cfg.projectId } : {}),
        ...(cfg.keyFilename ? { keyFilename: cfg.keyFilename } : {}),
      });
    case 'azure':
      return azureSink(cfg.container, {
        ...(cfg.prefix ? { prefix: cfg.prefix } : {}),
        ...(cfg.connectionString ? { connectionString: cfg.connectionString } : {}),
      });
    default:
      throw new Error(`Unknown export sink type: ${(cfg as { type: string }).type}`);
  }
}

export interface ScheduledExportsConfig {
  sink: SinkConfig;
  jobs: ExportJob[];
}

/** Parse SCHEDULED_EXPORTS into a validated config, or null when unset/empty. */
export function parseScheduledExports(json: string | undefined): ScheduledExportsConfig | null {
  if (!json?.trim()) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error('SCHEDULED_EXPORTS is not valid JSON');
  }
  const obj = parsed as { sink?: SinkConfig; jobs?: ExportJob[] };
  if (!obj.sink || typeof obj.sink.type !== 'string' || !Array.isArray(obj.jobs)) return null;
  const jobs = obj.jobs.filter(
    (j) => j && typeof j.tenantId === 'string' && typeof j.intervalMs === 'number' && j.intervalMs > 0,
  );
  if (jobs.length === 0) return null;
  return { sink: obj.sink, jobs };
}
