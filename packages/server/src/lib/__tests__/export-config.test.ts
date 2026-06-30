/**
 * Scheduled-export config (#151) — SCHEDULED_EXPORTS parsing + sink factory.
 */
import { describe, it, expect } from 'vitest';
import { readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { parseScheduledExports, sinkFromConfig } from '../export-config.js';
import { BlobSink } from '../sinks/blob-sink.js';
import { runExportJob } from '../export-scheduler.js';

describe('parseScheduledExports (#151)', () => {
  it('returns null for unset/empty/invalid-shape input', () => {
    expect(parseScheduledExports(undefined)).toBeNull();
    expect(parseScheduledExports('  ')).toBeNull();
    expect(parseScheduledExports('{"jobs":[]}')).toBeNull(); // no sink
    expect(parseScheduledExports('{"sink":{"type":"s3","bucket":"b"},"jobs":[]}')).toBeNull(); // no jobs
    expect(() => parseScheduledExports('{not json')).toThrow();
  });

  it('parses a valid config and filters invalid jobs', () => {
    const cfg = parseScheduledExports(JSON.stringify({
      sink: { type: 's3', bucket: 'exports', prefix: 'al' },
      jobs: [
        { tenantId: 'default', intervalMs: 3_600_000, format: 'ndjson', webhookUrl: 'https://h' },
        { tenantId: 'x', intervalMs: 0 }, // invalid interval → dropped
        { intervalMs: 1000 }, // no tenantId → dropped
      ],
    }))!;
    expect(cfg.sink).toEqual({ type: 's3', bucket: 'exports', prefix: 'al' });
    expect(cfg.jobs).toHaveLength(1);
    expect(cfg.jobs[0]!.tenantId).toBe('default');
  });
});

describe('sinkFromConfig (#151)', () => {
  it('builds a filesystem sink that writes to disk', async () => {
    const dir = join(tmpdir(), `al-exp-${randomUUID()}`);
    try {
      const sink = sinkFromConfig({ type: 'filesystem', dir });
      const { ref } = await sink.write('x.ndjson', '{"a":1}\n');
      expect(await readFile(ref, 'utf8')).toBe('{"a":1}\n');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('builds cloud sinks as BlobSinks (no SDK load until write)', () => {
    expect(sinkFromConfig({ type: 's3', bucket: 'b' })).toBeInstanceOf(BlobSink);
    expect(sinkFromConfig({ type: 'gcs', bucket: 'b' })).toBeInstanceOf(BlobSink);
    expect(sinkFromConfig({ type: 'azure', container: 'c' })).toBeInstanceOf(BlobSink);
  });

  it('runs a job with an async fetchEvents through the configured sink', async () => {
    const dir = join(tmpdir(), `al-exp-${randomUUID()}`);
    try {
      const sink = sinkFromConfig({ type: 'filesystem', dir });
      const res = await runExportJob(
        { tenantId: 't', intervalMs: 1000, format: 'ndjson' },
        { sink, now: () => Date.parse('2026-06-30T00:00:00Z'), fetchEvents: async () => [{ id: 'e1' }, { id: 'e2' }] },
      );
      expect(res.manifest.count).toBe(2);
      expect(await readFile(res.artifactRef, 'utf8')).toBe('{"id":"e1"}\n{"id":"e2"}\n');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
