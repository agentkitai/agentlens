/**
 * Blob ExportSinks (#151) — BlobSink wrapper + the S3 sink (mocked client).
 */
import { describe, it, expect } from 'vitest';
import { BlobSink, s3Sink, type S3LikeClient } from '../blob-sink.js';
import { runScheduledExport } from '../../scheduled-export.js';

describe('BlobSink (#151)', () => {
  it('writes via put with the right content-type and returns a prefixed ref', async () => {
    const calls: Array<{ key: string; content: string; contentType: string }> = [];
    const sink = new BlobSink(async (key, content, contentType) => { calls.push({ key, content, contentType }); }, 'gs://bucket/');
    expect((await sink.write('a.ndjson', '{"x":1}\n')).ref).toBe('gs://bucket/a.ndjson');
    expect((await sink.write('a.manifest.json', '{}')).ref).toBe('gs://bucket/a.manifest.json');
    expect(calls[0]!.contentType).toBe('application/x-ndjson');
    expect(calls[1]!.contentType).toBe('application/json');
  });
});

describe('s3Sink (#151)', () => {
  it('sends a PutObjectCommand with the bucket/prefixed-key/body/content-type', async () => {
    const sent: Array<{ input: Record<string, unknown> }> = [];
    const client: S3LikeClient = { send: async (c) => { sent.push(c as { input: Record<string, unknown> }); } };
    const sink = s3Sink('my-bucket', { prefix: 'exports/', client });

    const { ref } = await sink.write('agentlens-events-t.ndjson', '{"a":1}\n');
    expect(ref).toBe('s3://my-bucket/exports/agentlens-events-t.ndjson');
    expect(sent).toHaveLength(1);
    expect(sent[0]!.input.Bucket).toBe('my-bucket');
    expect(sent[0]!.input.Key).toBe('exports/agentlens-events-t.ndjson');
    expect(sent[0]!.input.Body).toBe('{"a":1}\n');
    expect(sent[0]!.input.ContentType).toBe('application/x-ndjson');
  });

  it('a scheduled export writes its artifact + signed manifest to the S3 sink', async () => {
    const keys: string[] = [];
    const client: S3LikeClient = { send: async (c) => { keys.push(((c as { input: { Key: string } }).input).Key); } };
    const sink = s3Sink('exports-bucket', { client });

    await runScheduledExport({
      sink,
      tenantId: 't1',
      from: '2026-06-01T00:00:00Z',
      to: '2026-06-30T00:00:00Z',
      format: 'ndjson',
      fetchEvents: () => [{ id: 'e1' }],
      generatedAt: '2026-06-30T00:00:00.000Z',
    });

    // both the artifact and the signed manifest landed in S3
    expect(keys.some((k) => k.endsWith('.ndjson'))).toBe(true);
    expect(keys.some((k) => k.endsWith('.manifest.json'))).toBe(true);
  });
});
