/**
 * Tests for the prompt deploy ledger + per-agent analytics (#120).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { createTestDb, type SqliteDb } from '../index.js';
import { runMigrations } from '../migrate.js';
import { PromptStore, getPromptEnvironments, type CreateTemplateInput } from '../prompt-store.js';
import { events as eventsTable, promptDeployments } from '../schema.sqlite.js';
import { sql } from 'drizzle-orm';

let db: SqliteDb;
let store: PromptStore;

const TENANT = 'test-tenant';

function makeInput(overrides: Partial<CreateTemplateInput> = {}): CreateTemplateInput {
  return { name: 'T', content: 'v1 content', category: 'system', ...overrides };
}

beforeEach(() => {
  db = createTestDb();
  runMigrations(db);
  store = new PromptStore(db);
});

/** A template with two versions; returns ids. */
function seedTemplate() {
  const { template, version } = store.createTemplate(TENANT, makeInput());
  const v2 = store.createVersion(template.id, TENANT, { content: 'v2 content' })!;
  return { templateId: template.id, v1: version.id, v2: v2.id };
}

describe('environments config', () => {
  it('defaults to staging + protected prod', () => {
    const envs = getPromptEnvironments();
    expect(envs.map((e) => e.name)).toEqual(['staging', 'prod']);
    expect(envs.find((e) => e.name === 'prod')!.protected).toBe(true);
    expect(envs.find((e) => e.name === 'staging')!.protected).toBe(false);
  });
});

describe('deploy ledger', () => {
  it('deploys a version live in an environment and resolves getLiveVersion', () => {
    const { templateId, v1, v2 } = seedTemplate();
    expect(store.getLiveVersion(TENANT, 'staging', templateId)).toBeNull();

    store.appendDeployment(TENANT, { templateId, environment: 'staging', versionId: v1, action: 'deploy', actorId: 'u1' });
    expect(store.getLiveVersion(TENANT, 'staging', templateId)).toBe(v1);

    store.appendDeployment(TENANT, { templateId, environment: 'staging', versionId: v2, action: 'deploy', actorId: 'u1' });
    expect(store.getLiveVersion(TENANT, 'staging', templateId)).toBe(v2);
  });

  it('keeps a distinct live version per environment', () => {
    const { templateId, v1, v2 } = seedTemplate();
    store.appendDeployment(TENANT, { templateId, environment: 'staging', versionId: v2, action: 'deploy' });
    store.appendDeployment(TENANT, { templateId, environment: 'prod', versionId: v1, action: 'deploy' });
    expect(store.getLiveVersions(TENANT, templateId)).toEqual({ staging: v2, prod: v1 });
  });

  it('rollback makes an earlier version live again', () => {
    const { templateId, v1, v2 } = seedTemplate();
    store.appendDeployment(TENANT, { templateId, environment: 'prod', versionId: v2, action: 'deploy' });
    store.appendDeployment(TENANT, { templateId, environment: 'prod', versionId: v1, action: 'rollback' });
    expect(store.getLiveVersion(TENANT, 'prod', templateId)).toBe(v1);
  });

  it('records a denied deploy without changing the live version', () => {
    const { templateId, v1, v2 } = seedTemplate();
    store.appendDeployment(TENANT, { templateId, environment: 'prod', versionId: v1, action: 'deploy' });
    const denied = store.appendDeployment(TENANT, {
      templateId, environment: 'prod', versionId: v2, action: 'deploy', status: 'denied', note: 'gate refused',
    });
    expect(denied!.status).toBe('denied');
    expect(store.getLiveVersion(TENANT, 'prod', templateId)).toBe(v1); // unchanged
    // The denial is still in the (verifiable) chain.
    expect(store.verifyDeployLedger(TENANT, 'prod').count).toBe(2);
  });

  it('rejects unknown environments and versions not on the template', () => {
    const { templateId, v1 } = seedTemplate();
    expect(store.appendDeployment(TENANT, { templateId, environment: 'nope', versionId: v1, action: 'deploy' })).toBeNull();
    expect(store.appendDeployment(TENANT, { templateId, environment: 'staging', versionId: 'missing', action: 'deploy' })).toBeNull();
  });

  it('isolates ledgers by tenant', () => {
    const { templateId, v1 } = seedTemplate();
    store.appendDeployment(TENANT, { templateId, environment: 'staging', versionId: v1, action: 'deploy' });
    expect(store.getLiveVersion('other-tenant', 'staging', templateId)).toBeNull();
  });

  it('lists deployment history newest-first', () => {
    const { templateId, v1, v2 } = seedTemplate();
    store.appendDeployment(TENANT, { templateId, environment: 'staging', versionId: v1, action: 'deploy' });
    store.appendDeployment(TENANT, { templateId, environment: 'staging', versionId: v2, action: 'deploy' });
    const history = store.listDeployments(TENANT, { templateId, environment: 'staging' });
    expect(history).toHaveLength(2);
    expect(history[0].seq).toBe(2);
    expect(history[1].seq).toBe(1);
  });
});

describe('deploy ledger integrity', () => {
  it('verifies a valid chain', () => {
    const { templateId, v1, v2 } = seedTemplate();
    store.appendDeployment(TENANT, { templateId, environment: 'prod', versionId: v1, action: 'deploy' });
    store.appendDeployment(TENANT, { templateId, environment: 'prod', versionId: v2, action: 'deploy' });
    store.appendDeployment(TENANT, { templateId, environment: 'prod', versionId: v1, action: 'rollback' });
    const result = store.verifyDeployLedger(TENANT, 'prod');
    expect(result.valid).toBe(true);
    expect(result.count).toBe(3);
  });

  it('detects a tampered row (edited after the fact)', () => {
    const { templateId, v1, v2 } = seedTemplate();
    store.appendDeployment(TENANT, { templateId, environment: 'prod', versionId: v1, action: 'deploy' });
    const second = store.appendDeployment(TENANT, { templateId, environment: 'prod', versionId: v2, action: 'deploy' })!;
    // Silently rewrite history: point the second deploy at a different version
    // without recomputing its hash.
    db.update(promptDeployments)
      .set({ versionId: v1 })
      .where(sql`${promptDeployments.id} = ${second.id}`)
      .run();
    const result = store.verifyDeployLedger(TENANT, 'prod');
    expect(result.valid).toBe(false);
    expect(result.brokenAtSeq).toBe(2);
  });

  it('an empty ledger verifies as valid', () => {
    expect(store.verifyDeployLedger(TENANT, 'prod')).toEqual({ environment: 'prod', valid: true, count: 0 });
  });
});

describe('per-agent analytics (#120)', () => {
  it('breaks usage + cost down by verified agent, falling back to raw agent id', () => {
    const { templateId, v1 } = seedTemplate();
    // Two generations on v1: one from a verified agent, one unverified.
    db.insert(eventsTable).values([
      { id: 'c1', timestamp: '2026-03-01T00:00:01Z', sessionId: 's1', agentId: 'agt_raw',
        eventType: 'llm_call', severity: 'info', prevHash: null, hash: 'h1', tenantId: TENANT,
        metadata: JSON.stringify({ verifiedAgentId: 'agt_verified' }),
        payload: JSON.stringify({ callId: 'c1', model: 'claude-haiku-4-5', promptVersionId: v1, messages: [] }) },
      { id: 'r1', timestamp: '2026-03-01T00:00:02Z', sessionId: 's1', agentId: 'agt_raw',
        eventType: 'llm_response', severity: 'info', prevHash: 'h1', hash: 'h2', tenantId: TENANT, metadata: '{}',
        payload: JSON.stringify({ callId: 'c1', model: 'claude-haiku-4-5', costUsd: 0.02, latencyMs: 10, finishReason: 'stop', usage: {} }) },
      { id: 'c2', timestamp: '2026-03-01T00:00:03Z', sessionId: 's2', agentId: 'agt_plain',
        eventType: 'llm_call', severity: 'info', prevHash: null, hash: 'h3', tenantId: TENANT, metadata: '{}',
        payload: JSON.stringify({ callId: 'c2', model: 'claude-haiku-4-5', promptVersionId: v1, messages: [] }) },
      { id: 'r2', timestamp: '2026-03-01T00:00:04Z', sessionId: 's2', agentId: 'agt_plain',
        eventType: 'llm_response', severity: 'info', prevHash: 'h3', hash: 'h4', tenantId: TENANT, metadata: '{}',
        payload: JSON.stringify({ callId: 'c2', model: 'claude-haiku-4-5', costUsd: 0.05, latencyMs: 20, finishReason: 'stop', usage: {} }) },
    ]).run();

    const usage = store.getVersionAnalyticsByAgent(templateId, TENANT, '2026-01-01T00:00:00Z', '2026-12-31T00:00:00Z');
    const verified = usage.find((u) => u.agentId === 'agt_verified')!;
    const plain = usage.find((u) => u.agentId === 'agt_plain')!;
    expect(verified.verified).toBe(true);
    expect(verified.callCount).toBe(1);
    expect(verified.totalCostUsd).toBeCloseTo(0.02);
    expect(plain.verified).toBe(false);
    expect(plain.totalCostUsd).toBeCloseTo(0.05);
  });
});
