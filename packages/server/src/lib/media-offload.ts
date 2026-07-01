/**
 * Media offloader (#252). Walks an event payload and rewrites large base64
 * data-URL strings (`data:<mediatype>;base64,<data>`) — the standard way images/
 * audio ride in LLM message content — to `media://<id>` refs, storing the blob in
 * the MediaStore. Keeps the events table lean; the GET route resolves refs.
 *
 * The `media://` ref is an opaque string, so downstream readers (replay, export)
 * pass it through unchanged — only a viewer that wants the bytes resolves it.
 */
import type { MediaStore } from '../db/media-store.js';

const DATA_URL = /^data:([\w.+-]+\/[\w.+-]+);base64,(.+)$/s;
/** Offload base64 data URLs larger than this (chars). Below it, inlining is cheap. */
const DEFAULT_THRESHOLD = 4096;

/**
 * Return a copy of `payload` with large base64 data URLs replaced by `media://<id>`
 * refs (blobs stored in `store`). Non-media / small strings are left untouched.
 */
export async function offloadPayload<T>(
  payload: T,
  tenantId: string,
  store: MediaStore,
  threshold: number = DEFAULT_THRESHOLD,
): Promise<T> {
  async function walk(value: unknown): Promise<unknown> {
    if (typeof value === 'string') {
      if (value.length > threshold) {
        const m = DATA_URL.exec(value);
        if (m) {
          const id = await store.store(tenantId, m[1]!, m[2]!);
          return `media://${id}`;
        }
      }
      return value;
    }
    if (Array.isArray(value)) {
      return Promise.all(value.map(walk));
    }
    if (value && typeof value === 'object') {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(value)) out[k] = await walk(v);
      return out;
    }
    return value;
  }
  return (await walk(payload)) as T;
}
