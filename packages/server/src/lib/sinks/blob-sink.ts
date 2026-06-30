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

// ─── Google Cloud Storage ───────────────────────────────────

/** Minimal GCS client surface (the real Storage satisfies it). */
export interface GcsLikeClient {
  bucket(name: string): { file(key: string): { save(content: string, opts: { contentType: string; resumable?: boolean }): Promise<void> } };
}

export interface GcsSinkOptions {
  prefix?: string;
  projectId?: string;
  keyFilename?: string;
  client?: GcsLikeClient;
}

/** A blob `put` backed by Google Cloud Storage via @google-cloud/storage. */
export function gcsPut(bucket: string, opts: GcsSinkOptions = {}): BlobPut {
  let clientPromise: Promise<GcsLikeClient> | null = null;
  const getClient = async (): Promise<GcsLikeClient> => {
    if (opts.client) return opts.client;
    if (!clientPromise) {
      clientPromise = import('@google-cloud/storage').then(
        ({ Storage }) =>
          new Storage({
            ...(opts.projectId ? { projectId: opts.projectId } : {}),
            ...(opts.keyFilename ? { keyFilename: opts.keyFilename } : {}),
          }) as unknown as GcsLikeClient,
      );
    }
    return clientPromise;
  };
  const prefix = opts.prefix ? opts.prefix.replace(/\/$/, '') + '/' : '';
  return async (key, content, contentType) => {
    const client = await getClient();
    await client.bucket(bucket).file(prefix + key).save(content, { contentType, resumable: false });
  };
}

/** An ExportSink writing exports to a GCS bucket. */
export function gcsSink(bucket: string, opts: GcsSinkOptions = {}): BlobSink {
  const refPrefix = `gs://${bucket}${opts.prefix ? '/' + opts.prefix.replace(/\/$/, '') : ''}`;
  return new BlobSink(gcsPut(bucket, opts), refPrefix);
}

// ─── Azure Blob Storage ─────────────────────────────────────

/** Minimal Azure client surface (the real BlobServiceClient satisfies it). */
export interface AzureLikeClient {
  getContainerClient(name: string): {
    getBlockBlobClient(key: string): {
      upload(content: string, length: number, opts: { blobHTTPHeaders: { blobContentType: string } }): Promise<unknown>;
    };
  };
}

export interface AzureSinkOptions {
  prefix?: string;
  connectionString?: string;
  client?: AzureLikeClient;
}

/** A blob `put` backed by Azure Blob Storage via @azure/storage-blob. */
export function azurePut(container: string, opts: AzureSinkOptions = {}): BlobPut {
  let clientPromise: Promise<AzureLikeClient> | null = null;
  const getClient = async (): Promise<AzureLikeClient> => {
    if (opts.client) return opts.client;
    if (!clientPromise) {
      clientPromise = import('@azure/storage-blob').then(({ BlobServiceClient }) => {
        if (!opts.connectionString) throw new Error('Azure export sink requires a connectionString');
        return BlobServiceClient.fromConnectionString(opts.connectionString) as unknown as AzureLikeClient;
      });
    }
    return clientPromise;
  };
  const prefix = opts.prefix ? opts.prefix.replace(/\/$/, '') + '/' : '';
  return async (key, content, contentType) => {
    const client = await getClient();
    await client
      .getContainerClient(container)
      .getBlockBlobClient(prefix + key)
      .upload(content, Buffer.byteLength(content), { blobHTTPHeaders: { blobContentType: contentType } });
  };
}

/** An ExportSink writing exports to an Azure Blob container. */
export function azureSink(container: string, opts: AzureSinkOptions = {}): BlobSink {
  const refPrefix = `azure://${container}${opts.prefix ? '/' + opts.prefix.replace(/\/$/, '') : ''}`;
  return new BlobSink(azurePut(container, opts), refPrefix);
}
