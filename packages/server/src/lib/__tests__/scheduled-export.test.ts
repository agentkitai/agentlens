/**
 * Scheduled signed exports (#151): NDJSON serialization + signed manifest that
 * verifies with the public key only.
 */
import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { runScheduledExport, toNdjson, type ExportSink } from '../scheduled-export.js';
import { verifyExport, getPublicJwk } from '../export-signing.js';

class MemSink implements ExportSink {
  files = new Map<string, string>();
  async write(name: string, content: string): Promise<{ ref: string }> {
    this.files.set(name, content);
    return { ref: `mem://${name}` };
  }
  find(ext: string): string {
    const hit = [...this.files.entries()].find(([n]) => n.endsWith(ext));
    if (!hit) throw new Error(`no ${ext} written`);
    return hit[1];
  }
}

describe('toNdjson', () => {
  it('writes one JSON object per line (trailing newline), empty for none', () => {
    expect(toNdjson([{ a: 1 }, { b: 2 }])).toBe('{"a":1}\n{"b":2}\n');
    expect(toNdjson([])).toBe('');
  });
});

describe('runScheduledExport', () => {
  const events = [{ id: 'e1', costUsd: 0.1 }, { id: 'e2', costUsd: 0.2 }];

  it('writes a signed NDJSON artifact + manifest verifiable with the public key', async () => {
    const sink = new MemSink();
    const res = await runScheduledExport({
      sink,
      tenantId: 't',
      from: '2026-01-01T00:00:00Z',
      to: '2026-02-01T00:00:00Z',
      format: 'ndjson',
      fetchEvents: () => events,
      generatedAt: '2026-03-01T00:00:00.000Z',
    });

    const artifact = sink.find('.ndjson');
    expect(artifact).toBe('{"id":"e1","costUsd":0.1}\n{"id":"e2","costUsd":0.2}\n');
    expect(res.manifest.count).toBe(2);
    expect(res.manifest.format).toBe('ndjson');
    // manifest binds the artifact via its SHA-256
    expect(res.manifest.contentSha256).toBe(createHash('sha256').update(artifact).digest('hex'));
    // third-party verifiable with the public JWK alone
    expect(verifyExport(res.manifest, res.signature, getPublicJwk())).toBe(true);
    // tampering the manifest (e.g. claiming fewer events) breaks the signature
    expect(verifyExport({ ...res.manifest, count: 1 }, res.signature, getPublicJwk())).toBe(false);

    // the signed manifest file is also persisted
    const manifestFile = JSON.parse(sink.find('.manifest.json'));
    expect(manifestFile.signature.type).toBe('ed25519');
    expect(manifestFile.contentSha256).toBe(res.manifest.contentSha256);
  });

  it('supports JSON format too', async () => {
    const sink = new MemSink();
    const res = await runScheduledExport({
      sink, tenantId: 't', from: 'a', to: 'b', format: 'json', fetchEvents: () => events, generatedAt: '2026-03-01T00:00:00.000Z',
    });
    expect(res.manifest.format).toBe('json');
    expect(JSON.parse(sink.find('.json')).count).toBe(2);
  });
});
