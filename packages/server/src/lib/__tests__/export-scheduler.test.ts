/**
 * Cron export scheduler + export.completed webhook (#151).
 */
import { describe, it, expect } from 'vitest';
import { runExportJob } from '../export-scheduler.js';
import { type ExportSink } from '../scheduled-export.js';
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

describe('runExportJob (#151)', () => {
  const events = [{ id: 'e1' }, { id: 'e2' }, { id: 'e3' }];
  const fixedNow = Date.parse('2026-06-30T12:00:00.000Z');

  it('exports the trailing window as signed NDJSON and fires export.completed', async () => {
    const sink = new MemSink();
    const fetched: Array<{ from: string; to: string }> = [];
    const webhookCalls: Array<{ url: string; body: string; headers: Record<string, string> }> = [];

    const res = await runExportJob(
      { tenantId: 't1', intervalMs: 3_600_000, format: 'ndjson', webhookUrl: 'https://hooks.example.com/x' },
      {
        sink,
        now: () => fixedNow,
        fetchEvents: (_t, from, to) => {
          fetched.push({ from, to });
          return events;
        },
        dispatch: async (url, body, headers) => {
          webhookCalls.push({ url, body, headers });
        },
      },
    );

    // window = [now - intervalMs, now]
    expect(fetched[0]!.to).toBe('2026-06-30T12:00:00.000Z');
    expect(fetched[0]!.from).toBe('2026-06-30T11:00:00.000Z');

    // signed NDJSON artifact verifies with the public key alone
    expect(sink.find('.ndjson')).toBe('{"id":"e1"}\n{"id":"e2"}\n{"id":"e3"}\n');
    const manifestDoc = JSON.parse(sink.find('.manifest.json'));
    const { signature, ...manifest } = manifestDoc;
    expect(manifest.count).toBe(3);
    expect(verifyExport(manifest, signature, getPublicJwk())).toBe(true);

    // export.completed webhook fired with the verifiable manifest reference
    expect(webhookCalls).toHaveLength(1);
    expect(webhookCalls[0]!.url).toBe('https://hooks.example.com/x');
    const event = JSON.parse(webhookCalls[0]!.body);
    expect(event.event).toBe('export.completed');
    expect(event.manifestRef).toBe(res.manifestRef);
    expect(event.manifest.contentSha256).toBe(res.manifest.contentSha256);
  });

  it('does not fire a webhook when no webhookUrl is configured', async () => {
    const sink = new MemSink();
    let called = 0;
    await runExportJob(
      { tenantId: 't2', intervalMs: 1000 },
      { sink, now: () => fixedNow, fetchEvents: () => events, dispatch: async () => { called++; } },
    );
    expect(called).toBe(0);
  });
});
