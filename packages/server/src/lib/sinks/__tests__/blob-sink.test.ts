/**
 * Blob ExportSinks (#151) — BlobSink wrapper + the S3 sink (mocked client).
 */
import { describe, it, expect } from 'vitest';
import {
  BlobSink,
  s3Sink,
  gcsSink,
  azureSink,
  type S3LikeClient,
  type GcsLikeClient,
  type AzureLikeClient,
} from '../blob-sink.js';
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

describe('gcsSink (#151)', () => {
  it('saves to bucket.file(prefixed key) with the content-type', async () => {
    const saved: Array<{ key: string; content: string; contentType: string }> = [];
    const client: GcsLikeClient = {
      bucket: () => ({
        file: (key: string) => ({
          save: async (content: string, o: { contentType: string }) => { saved.push({ key, content, contentType: o.contentType }); },
        }),
      }),
    };
    const sink = gcsSink('gbucket', { prefix: 'exp', client });
    const { ref } = await sink.write('x.json', '{}');
    expect(ref).toBe('gs://gbucket/exp/x.json');
    expect(saved[0]).toEqual({ key: 'exp/x.json', content: '{}', contentType: 'application/json' });
  });
});

describe('azureSink (#151)', () => {
  it('uploads to the container block blob with byte length + content-type', async () => {
    const uploads: Array<{ key: string; content: string; length: number; contentType: string }> = [];
    const client: AzureLikeClient = {
      getContainerClient: () => ({
        getBlockBlobClient: (key: string) => ({
          upload: async (content: string, length: number, o: { blobHTTPHeaders: { blobContentType: string } }) => {
            uploads.push({ key, content, length, contentType: o.blobHTTPHeaders.blobContentType });
            return {};
          },
        }),
      }),
    };
    const sink = azureSink('container1', { client });
    const { ref } = await sink.write('y.ndjson', '{"a":1}\n');
    expect(ref).toBe('azure://container1/y.ndjson');
    expect(uploads[0]!.key).toBe('y.ndjson');
    expect(uploads[0]!.length).toBe(Buffer.byteLength('{"a":1}\n'));
    expect(uploads[0]!.contentType).toBe('application/x-ndjson');
  });
});
