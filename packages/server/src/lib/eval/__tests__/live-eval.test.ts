/**
 * #254 — LiveEvalEngine: sample a completed session and score its last model
 * output, writing an eval_result. Deterministic (regex scorer + injected rng).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { createTestDb } from '../../../db/index.js';
import { runMigrations } from '../../../db/migrate.js';
import { SqliteEventStore } from '../../../db/sqlite-store.js';
import { appendEventToSession } from '../../append-event.js';
import { runLiveEval, LiveEvalStore, type LiveEvalConfig } from '../live-eval.js';

const cfg = (over: Partial<LiveEvalConfig> = {}): LiveEvalConfig => ({
  enabled: true,
  samplingRate: 1,
  scorerType: 'regex',
  scorerConfig: { type: 'regex', pattern: 'hello' } as LiveEvalConfig['scorerConfig'],
  ...over,
});

describe('LiveEvalEngine (#254)', () => {
  let db: any;
  let store: SqliteEventStore;

  beforeEach(async () => {
    db = createTestDb();
    runMigrations(db);
    store = new SqliteEventStore(db);
    await appendEventToSession(store, {
      tenantId: 'default', sessionId: 's1', agentId: 'a',
      eventType: 'llm_response', severity: 'info', payload: { content: 'hello world' },
    });
  });

  it('scores a sampled session and appends an eval_result', async () => {
    const did = await runLiveEval({ tenantId: 'default', sessionId: 's1', agentId: 'a', store, config: cfg(), rng: () => 0 });
    expect(did).toBe(true);
    const evalEvt = (await store.getSessionTimeline('s1')).find((e) => e.eventType === 'eval_result');
    expect(evalEvt).toBeTruthy();
    expect((evalEvt!.payload as any).score).toBe(1);
    expect((evalEvt!.payload as any).passed).toBe(true);
    expect((evalEvt!.payload as any).scorerType).toBe('regex');
  });

  it('scores 0 when the output does not match the pattern', async () => {
    const did = await runLiveEval({
      tenantId: 'default', sessionId: 's1', agentId: 'a', store,
      config: cfg({ scorerConfig: { type: 'regex', pattern: 'goodbye' } as LiveEvalConfig['scorerConfig'] }), rng: () => 0,
    });
    expect(did).toBe(true);
    const evalEvt = (await store.getSessionTimeline('s1')).find((e) => e.eventType === 'eval_result');
    expect((evalEvt!.payload as any).score).toBe(0);
    expect((evalEvt!.payload as any).passed).toBe(false);
  });

  it('respects the sampling rate (rng above rate → skip)', async () => {
    const did = await runLiveEval({ tenantId: 'default', sessionId: 's1', agentId: 'a', store, config: cfg({ samplingRate: 0.5 }), rng: () => 0.9 });
    expect(did).toBe(false);
    expect((await store.getSessionTimeline('s1')).some((e) => e.eventType === 'eval_result')).toBe(false);
  });

  it('skips when disabled', async () => {
    const did = await runLiveEval({ tenantId: 'default', sessionId: 's1', agentId: 'a', store, config: cfg({ enabled: false }), rng: () => 0 });
    expect(did).toBe(false);
  });

  it('config store round-trips', async () => {
    const s = new LiveEvalStore(db);
    await s.set('default', cfg({ samplingRate: 0.25 }));
    const got = await s.get('default');
    expect(got?.enabled).toBe(true);
    expect(got?.samplingRate).toBe(0.25);
    expect((got?.scorerConfig as any).pattern).toBe('hello');
  });
});
