import { describe, it, expect, beforeEach } from 'vitest';
import { InMemoryPoolStore, cosineSimilarity } from '../store.js';

describe('cosineSimilarity', () => {
  it('returns 1 for identical vectors', () => {
    expect(cosineSimilarity([1, 0, 0], [1, 0, 0])).toBeCloseTo(1);
  });

  it('returns 0 for orthogonal vectors', () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0);
  });

  it('returns -1 for opposite vectors', () => {
    expect(cosineSimilarity([1, 0], [-1, 0])).toBeCloseTo(-1);
  });

  it('returns 0 for empty vectors', () => {
    expect(cosineSimilarity([], [])).toBe(0);
  });

  it('returns 0 for mismatched lengths', () => {
    expect(cosineSimilarity([1, 2], [1])).toBe(0);
  });

  it('returns 0 for zero vectors', () => {
    expect(cosineSimilarity([0, 0], [0, 0])).toBe(0);
  });

  it('computes correct similarity for arbitrary vectors', () => {
    const a = [1, 2, 3];
    const b = [4, 5, 6];
    // dot=32, |a|=sqrt(14), |b|=sqrt(77)
    const expected = 32 / (Math.sqrt(14) * Math.sqrt(77));
    expect(cosineSimilarity(a, b)).toBeCloseTo(expected);
  });
});

describe('InMemoryPoolStore', () => {
  let store: InMemoryPoolStore;

  beforeEach(() => {
    store = new InMemoryPoolStore();
  });

  // ─── Lessons ───

  describe('shareLesson', () => {
    it('creates a lesson with all fields', async () => {
      const lesson = await store.shareLesson({
        anonymousContributorId: 'c1',
        category: 'debugging',
        title: 'Test',
        content: 'Content',
        embedding: [1, 0, 0],
      });
      expect(lesson.id).toBeTruthy();
      expect(lesson.anonymousContributorId).toBe('c1');
      expect(lesson.category).toBe('debugging');
      expect(lesson.reputationScore).toBe(50);
      expect(lesson.flagCount).toBe(0);
      expect(lesson.hidden).toBe(false);
    });

    it('assigns unique IDs', async () => {
      const l1 = await store.shareLesson({ anonymousContributorId: 'c1', category: 'a', title: 'T', content: 'C', embedding: [1] });
      const l2 = await store.shareLesson({ anonymousContributorId: 'c1', category: 'a', title: 'T', content: 'C', embedding: [1] });
      expect(l1.id).not.toBe(l2.id);
    });

    it('stores qualitySignals', async () => {
      const lesson = await store.shareLesson({
        anonymousContributorId: 'c1', category: 'a', title: 'T', content: 'C',
        embedding: [1], qualitySignals: { successRate: 0.9 },
      });
      expect(lesson.qualitySignals).toEqual({ successRate: 0.9 });
    });
  });

  describe('getLessonById', () => {
    it('returns lesson when exists', async () => {
      const lesson = await store.shareLesson({ anonymousContributorId: 'c1', category: 'a', title: 'T', content: 'C', embedding: [1] });
      const found = await store.getLessonById(lesson.id);
      expect(found).toEqual(lesson);
    });

    it('returns null when not found', async () => {
      expect(await store.getLessonById('nonexistent')).toBeNull();
    });
  });

  describe('searchLessons', () => {
    it('returns lessons sorted by similarity', async () => {
      await store.shareLesson({ anonymousContributorId: 'c1', category: 'a', title: 'T1', content: 'C1', embedding: [1, 0, 0] });
      await store.shareLesson({ anonymousContributorId: 'c1', category: 'a', title: 'T2', content: 'C2', embedding: [0.9, 0.1, 0] });
      await store.shareLesson({ anonymousContributorId: 'c1', category: 'a', title: 'T3', content: 'C3', embedding: [0, 1, 0] });

      const results = await store.searchLessons({ embedding: [1, 0, 0] });
      expect(results.length).toBe(3);
      expect(results[0].lesson.title).toBe('T1');
      expect(results[0].similarity).toBeCloseTo(1);
    });

    it('filters by category', async () => {
      await store.shareLesson({ anonymousContributorId: 'c1', category: 'debug', title: 'T1', content: 'C', embedding: [1, 0] });
      await store.shareLesson({ anonymousContributorId: 'c1', category: 'perf', title: 'T2', content: 'C', embedding: [1, 0] });

      const results = await store.searchLessons({ embedding: [1, 0], category: 'debug' });
      expect(results.length).toBe(1);
      expect(results[0].lesson.category).toBe('debug');
    });

    it('filters by minReputation', async () => {
      const l = await store.shareLesson({ anonymousContributorId: 'c1', category: 'a', title: 'T', content: 'C', embedding: [1] });
      await store.updateLessonReputation(l.id, 10);

      const results = await store.searchLessons({ embedding: [1], minReputation: 30 });
      expect(results.length).toBe(0);
    });

    it('excludes hidden lessons', async () => {
      const l = await store.shareLesson({ anonymousContributorId: 'c1', category: 'a', title: 'T', content: 'C', embedding: [1] });
      await store.setLessonHidden(l.id, true);

      const results = await store.searchLessons({ embedding: [1] });
      expect(results.length).toBe(0);
    });

    it('respects limit', async () => {
      for (let i = 0; i < 5; i++) {
        await store.shareLesson({ anonymousContributorId: 'c1', category: 'a', title: `T${i}`, content: 'C', embedding: [1] });
      }
      const results = await store.searchLessons({ embedding: [1], limit: 2 });
      expect(results.length).toBe(2);
    });
  });

  describe('deleteLessonsByContributor', () => {
    it('deletes all lessons for a contributor', async () => {
      await store.shareLesson({ anonymousContributorId: 'c1', category: 'a', title: 'T', content: 'C', embedding: [1] });
      await store.shareLesson({ anonymousContributorId: 'c1', category: 'a', title: 'T2', content: 'C', embedding: [1] });
      await store.shareLesson({ anonymousContributorId: 'c2', category: 'a', title: 'T3', content: 'C', embedding: [1] });

      const deleted = await store.deleteLessonsByContributor('c1');
      expect(deleted).toBe(2);
      expect(await store.countLessonsByContributor('c1')).toBe(0);
      expect(await store.countLessonsByContributor('c2')).toBe(1);
    });

    it('returns 0 when no lessons found', async () => {
      expect(await store.deleteLessonsByContributor('nonexistent')).toBe(0);
    });
  });

  describe('countLessonsByContributor', () => {
    it('returns correct count', async () => {
      await store.shareLesson({ anonymousContributorId: 'c1', category: 'a', title: 'T', content: 'C', embedding: [1] });
      await store.shareLesson({ anonymousContributorId: 'c1', category: 'a', title: 'T2', content: 'C', embedding: [1] });
      expect(await store.countLessonsByContributor('c1')).toBe(2);
    });

    it('returns 0 for unknown contributor', async () => {
      expect(await store.countLessonsByContributor('unknown')).toBe(0);
    });
  });

  describe('updateLessonReputation', () => {
    it('updates score', async () => {
      const l = await store.shareLesson({ anonymousContributorId: 'c1', category: 'a', title: 'T', content: 'C', embedding: [1] });
      await store.updateLessonReputation(l.id, 75);
      const found = await store.getLessonById(l.id);
      expect(found!.reputationScore).toBe(75);
    });
  });

  describe('updateLessonFlagCount', () => {
    it('updates flag count', async () => {
      const l = await store.shareLesson({ anonymousContributorId: 'c1', category: 'a', title: 'T', content: 'C', embedding: [1] });
      await store.updateLessonFlagCount(l.id, 3);
      const found = await store.getLessonById(l.id);
      expect(found!.flagCount).toBe(3);
    });
  });

  // ─── Reputation Events ───

  describe('reputationEvents', () => {
    it('adds and retrieves reputation events', async () => {
      const event = await store.addReputationEvent({
        lessonId: 'l1', voterAnonymousId: 'v1', delta: 1, reason: 'implicit_success', createdEpoch: 1000,
      });
      expect(event.id).toBeTruthy();
      const events = await store.getReputationEvents('l1');
      expect(events.length).toBe(1);
      expect(events[0].delta).toBe(1);
    });

    it('returns empty for unknown lesson', async () => {
      expect(await store.getReputationEvents('unknown')).toEqual([]);
    });
  });

  // ─── Moderation Flags ───

  describe('moderationFlags', () => {
    it('adds and retrieves flags', async () => {
      const flag = await store.addModerationFlag({
        lessonId: 'l1', reporterAnonymousId: 'r1', reason: 'spam', createdEpoch: 1000,
      });
      expect(flag.id).toBeTruthy();
      const flags = await store.getModerationFlags('l1');
      expect(flags.length).toBe(1);
    });

    it('detects duplicate flags', async () => {
      await store.addModerationFlag({ lessonId: 'l1', reporterAnonymousId: 'r1', reason: 'spam', createdEpoch: 1000 });
      expect(await store.hasAlreadyFlagged('l1', 'r1')).toBe(true);
      expect(await store.hasAlreadyFlagged('l1', 'r2')).toBe(false);
    });
  });

  // ─── Purge Tokens ───

  describe('purgeTokens', () => {
    it('sets and retrieves purge token', async () => {
      await store.setPurgeToken('c1', 'hash123');
      const token = await store.getPurgeToken('c1');
      expect(token!.tokenHash).toBe('hash123');
    });

    it('returns null for unknown contributor', async () => {
      expect(await store.getPurgeToken('unknown')).toBeNull();
    });
  });

  // ─── Capabilities ───

  describe('registerCapability', () => {
    it('creates a capability with defaults', async () => {
      const cap = await store.registerCapability({
        anonymousAgentId: 'a1', taskType: 'summarize',
        inputSchema: { type: 'string' }, outputSchema: { type: 'string' },
      });
      expect(cap.id).toBeTruthy();
      expect(cap.active).toBe(true);
      expect(cap.scope).toBe('public');
      expect(cap.trustScorePercentile).toBe(50);
    });
  });

  describe('discoverCapabilities', () => {
    it('returns active capabilities matching taskType', async () => {
      await store.registerCapability({ anonymousAgentId: 'a1', taskType: 'summarize', inputSchema: {}, outputSchema: {} });
      await store.registerCapability({ anonymousAgentId: 'a2', taskType: 'translate', inputSchema: {}, outputSchema: {} });

      const results = await store.discoverCapabilities({ taskType: 'summarize' });
      expect(results.length).toBe(1);
      expect(results[0].taskType).toBe('summarize');
    });

    it('filters by minTrust', async () => {
      await store.registerCapability({ anonymousAgentId: 'a1', taskType: 'summarize', inputSchema: {}, outputSchema: {}, trustScorePercentile: 30 });
      const results = await store.discoverCapabilities({ taskType: 'summarize', minTrust: 50 });
      expect(results.length).toBe(0);
    });

    it('filters by maxLatencyMs', async () => {
      await store.registerCapability({ anonymousAgentId: 'a1', taskType: 'summarize', inputSchema: {}, outputSchema: {}, estimatedLatencyMs: 500 });
      const results = await store.discoverCapabilities({ maxLatencyMs: 200 });
      expect(results.length).toBe(0);
    });

    it('filters by maxCostUsd', async () => {
      await store.registerCapability({ anonymousAgentId: 'a1', taskType: 'summarize', inputSchema: {}, outputSchema: {}, estimatedCostUsd: 1.5 });
      const results = await store.discoverCapabilities({ maxCostUsd: 1.0 });
      expect(results.length).toBe(0);
    });

    it('sorts by trust score descending', async () => {
      await store.registerCapability({ anonymousAgentId: 'a1', taskType: 'summarize', inputSchema: {}, outputSchema: {}, trustScorePercentile: 30 });
      await store.registerCapability({ anonymousAgentId: 'a2', taskType: 'summarize', inputSchema: {}, outputSchema: {}, trustScorePercentile: 90 });
      const results = await store.discoverCapabilities({ taskType: 'summarize' });
      expect(results[0].trustScorePercentile).toBe(90);
    });

    it('respects limit', async () => {
      for (let i = 0; i < 5; i++) {
        await store.registerCapability({ anonymousAgentId: `a${i}`, taskType: 'summarize', inputSchema: {}, outputSchema: {} });
      }
      const results = await store.discoverCapabilities({ taskType: 'summarize', limit: 2 });
      expect(results.length).toBe(2);
    });

    it('excludes inactive capabilities', async () => {
      const cap = await store.registerCapability({ anonymousAgentId: 'a1', taskType: 'summarize', inputSchema: {}, outputSchema: {} });
      await store.unregisterCapability(cap.id);
      const results = await store.discoverCapabilities({ taskType: 'summarize' });
      expect(results.length).toBe(0);
    });
  });

  describe('getCapabilitiesByAgent', () => {
    it('returns all capabilities for an agent', async () => {
      await store.registerCapability({ anonymousAgentId: 'a1', taskType: 'summarize', inputSchema: {}, outputSchema: {} });
      await store.registerCapability({ anonymousAgentId: 'a1', taskType: 'translate', inputSchema: {}, outputSchema: {} });
      await store.registerCapability({ anonymousAgentId: 'a2', taskType: 'summarize', inputSchema: {}, outputSchema: {} });
      const caps = await store.getCapabilitiesByAgent('a1');
      expect(caps.length).toBe(2);
    });
  });

  describe('unregisterCapability', () => {
    it('marks capability as inactive', async () => {
      const cap = await store.registerCapability({ anonymousAgentId: 'a1', taskType: 'summarize', inputSchema: {}, outputSchema: {} });
      const result = await store.unregisterCapability(cap.id);
      expect(result).toBe(true);
      const found = await store.getCapabilityById(cap.id);
      expect(found!.active).toBe(false);
    });

    it('returns false for unknown capability', async () => {
      expect(await store.unregisterCapability('unknown')).toBe(false);
    });
  });

  // ─── Delegation ───

  describe('createDelegation', () => {
    it('creates a pending delegation', async () => {
      const d = await store.createDelegation({
        id: 'd1', requesterAnonymousId: 'r1', targetAnonymousId: 't1',
        taskType: 'summarize', inputData: '{"text":"hello"}', timeoutMs: 30000,
      });
      expect(d.status).toBe('pending');
      expect(d.id).toBe('d1');
    });

    it('is idempotent on same ID', async () => {
      const input = {
        id: 'd1', requesterAnonymousId: 'r1', targetAnonymousId: 't1',
        taskType: 'summarize', inputData: '{}', timeoutMs: 30000,
      };
      const d1 = await store.createDelegation(input);
      const d2 = await store.createDelegation(input);
      expect(d1).toEqual(d2);
    });
  });

  describe('getDelegationInbox', () => {
    it('returns pending delegations for target', async () => {
      await store.createDelegation({
        id: 'd1', requesterAnonymousId: 'r1', targetAnonymousId: 't1',
        taskType: 'summarize', inputData: '{}', timeoutMs: 60000,
      });
      await store.createDelegation({
        id: 'd2', requesterAnonymousId: 'r1', targetAnonymousId: 't2',
        taskType: 'summarize', inputData: '{}', timeoutMs: 60000,
      });
      const inbox = await store.getDelegationInbox('t1');
      expect(inbox.length).toBe(1);
      expect(inbox[0].id).toBe('d1');
    });

    it('excludes non-pending delegations', async () => {
      await store.createDelegation({
        id: 'd1', requesterAnonymousId: 'r1', targetAnonymousId: 't1',
        taskType: 'summarize', inputData: '{}', timeoutMs: 60000,
      });
      await store.updateDelegationStatus('d1', 'accepted');
      const inbox = await store.getDelegationInbox('t1');
      expect(inbox.length).toBe(0);
    });
  });

  describe('updateDelegationStatus', () => {
    it('updates status to accepted', async () => {
      await store.createDelegation({
        id: 'd1', requesterAnonymousId: 'r1', targetAnonymousId: 't1',
        taskType: 'summarize', inputData: '{}', timeoutMs: 60000,
      });
      const updated = await store.updateDelegationStatus('d1', 'accepted');
      expect(updated!.status).toBe('accepted');
    });

    it('updates status to completed with output', async () => {
      await store.createDelegation({
        id: 'd1', requesterAnonymousId: 'r1', targetAnonymousId: 't1',
        taskType: 'summarize', inputData: '{}', timeoutMs: 60000,
      });
      const updated = await store.updateDelegationStatus('d1', 'completed', '{"result":"done"}');
      expect(updated!.status).toBe('completed');
      expect(updated!.outputData).toBe('{"result":"done"}');
      expect(updated!.completedEpoch).toBeTruthy();
    });

    it('returns null for unknown delegation', async () => {
      expect(await store.updateDelegationStatus('unknown', 'accepted')).toBeNull();
    });
  });

  describe('reset', () => {
    it('clears all data', async () => {
      await store.shareLesson({ anonymousContributorId: 'c1', category: 'a', title: 'T', content: 'C', embedding: [1] });
      await store.registerCapability({ anonymousAgentId: 'a1', taskType: 'summarize', inputSchema: {}, outputSchema: {} });
      store.reset();
      expect(await store.countLessonsByContributor('c1')).toBe(0);
      expect((await store.discoverCapabilities({})).length).toBe(0);
    });
  });
});
