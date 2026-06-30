/**
 * Blob-storage ExportSinks (#151). A BlobSink wraps an injectable `put` (so it is
 * testable without cloud creds); cloud factories build the put from a provider
 * SDK (lazy-imported, so the SDK only loads when the sink is actually used).
 * S3 ships here; GCS / Azure are the same shape (follow-up slices).
 */
import type { ExportSink } from '../scheduled-export.js';

export type BlobPut = (key: string, content: string, contentType: string) => Promise<void>;

function contentTypeFor(name: string): string {
  if (name.endsWith('.ndjson')) return 'application/x-ndjson';
  if (name.endsWith('.json')) return 'application/json';
  return 'text/plain';
}

/** ExportSink backed by an injectable blob `put`. */
export class BlobSink implements ExportSink {
  constructor(
    private readonly put: BlobPut,
    private readonly refPrefix: string,
  ) {}
  async write(name: string, content: string): Promise<{ ref: string }> {
    await this.put(name, content, contentTypeFor(name));
    return { ref: `${this.refPrefix.replace(/\/$/, '')}/${name}` };
  }
}

/** Minimal AWS S3 client surface (the real S3Client satisfies it). */
export interface S3LikeClient {
  send(command: unknown): Promise<unknown>;
}

export interface S3SinkOptions {
  region?: string;
  /** S3-compatible endpoint (MinIO / Cloudflare R2 / etc.). */
  endpoint?: string;
  /** Key prefix within the bucket. */
  prefix?: string;
  /** Inject a client (with .send) for testing; otherwise a real S3Client is built. */
  client?: S3LikeClient;
}

/** A blob `put` backed by S3 (and S3-compatible stores) via @aws-sdk/client-s3. */
export function s3Put(bucket: string, opts: S3SinkOptions = {}): BlobPut {
  let clientPromise: Promise<S3LikeClient> | null = null;
  const getClient = async (): Promise<S3LikeClient> => {
    if (opts.client) return opts.client;
    if (!clientPromise) {
      clientPromise = import('@aws-sdk/client-s3').then(
        ({ S3Client }) =>
          new S3Client({
            ...(opts.region ? { region: opts.region } : {}),
            ...(opts.endpoint ? { endpoint: opts.endpoint, forcePathStyle: true } : {}),
          }) as unknown as S3LikeClient,
      );
    }
    return clientPromise;
  };
  const prefix = opts.prefix ? opts.prefix.replace(/\/$/, '') + '/' : '';
  return async (key, content, contentType) => {
    const { PutObjectCommand } = await import('@aws-sdk/client-s3');
    const client = await getClient();
    await client.send(new PutObjectCommand({ Bucket: bucket, Key: prefix + key, Body: content, ContentType: contentType }));
  };
}

/** An ExportSink writing exports to an S3 bucket. */
export function s3Sink(bucket: string, opts: S3SinkOptions = {}): BlobSink {
  const refPrefix = `s3://${bucket}${opts.prefix ? '/' + opts.prefix.replace(/\/$/, '') : ''}`;
  return new BlobSink(s3Put(bucket, opts), refPrefix);
}
