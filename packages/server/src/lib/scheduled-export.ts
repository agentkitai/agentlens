/**
 * Scheduled, signed blob exports (#151).
 *
 * A cron-driven job collects a tenant's events for a window, serializes them
 * (NDJSON or JSON), and writes the artifact + a signed manifest to a pluggable
 * `ExportSink`. The filesystem sink ships here; S3 / GCS / Azure are drop-in
 * implementations of the same interface. The manifest is Ed25519-signed (the
 * existing export-signing path) over the artifact's SHA-256, so a third party
 * verifies the export with the public JWK alone.
 */
import { createHash } from 'node:crypto';
import { writeFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { signExport, type ExportSignature } from './export-signing.js';

export type ExportFormat = 'ndjson' | 'json';

export interface ExportSink {
  /** Persist `content` under `name`; return a reference (path / URL / key). */
  write(name: string, content: string): Promise<{ ref: string }>;
}

/** Default OSS sink: writes under a configured directory ("bucket"). */
export class FilesystemSink implements ExportSink {
  constructor(private readonly dir: string) {}
  async write(name: string, content: string): Promise<{ ref: string }> {
    const path = join(this.dir, name);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, content, 'utf8');
    return { ref: path };
  }
}

/** Serialize events as newline-delimited JSON (one object per line). */
export function toNdjson(events: unknown[]): string {
  return events.length ? events.map((e) => JSON.stringify(e)).join('\n') + '\n' : '';
}

export interface ExportManifest {
  kind: 'agentlens.scheduled-export/v1';
  tenantId: string;
  from: string;
  to: string;
  format: ExportFormat;
  count: number;
  artifactRef: string;
  contentSha256: string;
  generatedAt: string;
}

export interface ScheduledExportResult {
  manifest: ExportManifest;
  signature: ExportSignature;
  artifactRef: string;
  manifestRef: string;
}

export interface ScheduledExportOptions {
  sink: ExportSink;
  tenantId: string;
  from: string;
  to: string;
  format?: ExportFormat;
  /** Tenant+range event fetcher (decoupled for testability). */
  fetchEvents: (tenantId: string, from: string, to: string) => unknown[];
  /** ISO timestamp stamped into the manifest + filenames (caller-supplied). */
  generatedAt: string;
  /** Filename prefix (default 'agentlens-events'). */
  prefix?: string;
}

/** Run one export: write the artifact + a signed manifest to the sink. */
export async function runScheduledExport(opts: ScheduledExportOptions): Promise<ScheduledExportResult> {
  const format = opts.format ?? 'ndjson';
  const events = opts.fetchEvents(opts.tenantId, opts.from, opts.to);
  const content =
    format === 'ndjson'
      ? toNdjson(events)
      : JSON.stringify({ tenantId: opts.tenantId, from: opts.from, to: opts.to, count: events.length, events });

  const base = `${opts.prefix ?? 'agentlens-events'}-${opts.tenantId}-${opts.generatedAt.replace(/[:.]/g, '-')}`;
  const artifactName = `${base}.${format}`;
  const { ref: artifactRef } = await opts.sink.write(artifactName, content);

  const manifest: ExportManifest = {
    kind: 'agentlens.scheduled-export/v1',
    tenantId: opts.tenantId,
    from: opts.from,
    to: opts.to,
    format,
    count: events.length,
    artifactRef,
    contentSha256: createHash('sha256').update(content).digest('hex'),
    generatedAt: opts.generatedAt,
  };
  const signature = signExport(manifest);
  const { ref: manifestRef } = await opts.sink.write(`${base}.manifest.json`, JSON.stringify({ ...manifest, signature }, null, 2));

  return { manifest, signature, artifactRef, manifestRef };
}
