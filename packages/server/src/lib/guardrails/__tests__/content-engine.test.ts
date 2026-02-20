/**
 * Tests for Content Guardrail Engine (Feature 8 — Story 7) [F8-S7]
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ulid } from 'ulid';
import { createTestDb, type SqliteDb } from '../../../db/index.js';
import { runMigrations } from '../../../db/migrate.js';
import { GuardrailStore } from '../../../db/guardrail-store.js';
import { ContentGuardrailEngine } from '../content-engine.js';
import { invalidateAllScanners } from '../scanners/scanner-registry.js';
import type { GuardrailRule } from '@agentlensai/core';

let db: SqliteDb;
let store: GuardrailStore;
let engine: ContentGuardrailEngine;

function makeRule(overrides: Partial<GuardrailRule> = {}): GuardrailRule {
  const now = new Date().toISOString();
  return {
    id: ulid(),
    tenantId: 'tenant-1',
    name: 'Test Rule',
    enabled: true,
    conditionType: 'pii_detection',
    conditionConfig: { patterns: ['ssn'] },
    actionType: 'block',
    actionConfig: {},
    cooldownMinutes: 15,
    dryRun: false,
    createdAt: now,
    updatedAt: now,
    direction: 'both',
    priority: 0,
    ...overrides,
  };
}

beforeEach(() => {
  db = createTestDb();
  runMigrations(db);
  store = new GuardrailStore(db);
  engine = new ContentGuardrailEngine(store);
  invalidateAllScanners();
});

afterEach(() => {
  invalidateAllScanners();
});

describe('ContentGuardrailEngine', () => {
  it('returns allow for empty content', async () => {
    const result = await engine.evaluateContentSync('', {
      tenantId: 'tenant-1', agentId: 'a1', toolName: 'test', direction: 'input',
    });
    expect(result.decision).toBe('allow');
    expect(result.matches).toHaveLength(0);
  });

  it('returns allow when no rules exist', async () => {
    const result = await engine.evaluateContentSync('some text', {
      tenantId: 'tenant-1', agentId: 'a1', toolName: 'test', direction: 'input',
    });
    expect(result.decision).toBe('allow');
  });

  it('blocks content matching PII rule', async () => {
    const rule = makeRule({ actionType: 'block' });
    store.createRule(rule);

    const result = await engine.evaluateContentSync('SSN: 123-45-6789', {
      tenantId: 'tenant-1', agentId: 'a1', toolName: 'test', direction: 'input',
    });
    expect(result.decision).toBe('block');
    expect(result.blockingRuleId).toBe(rule.id);
    expect(result.matches).toHaveLength(1);
  });

  it('redacts content matching PII rule', async () => {
    const rule = makeRule({ actionType: 'redact' });
    store.createRule(rule);

    const result = await engine.evaluateContentSync('SSN: 123-45-6789 end', {
      tenantId: 'tenant-1', agentId: 'a1', toolName: 'test', direction: 'input',
    });
    expect(result.decision).toBe('redact');
    expect(result.redactedContent).toBe('SSN: [SSN_REDACTED] end');
  });

  it('evaluates rules in priority order (highest first)', async () => {
    // Low-priority redact rule
    const rule1 = makeRule({
      actionType: 'redact',
      priority: 0,
      conditionConfig: { patterns: ['email'] },
    });
    // High-priority block rule
    const rule2 = makeRule({
      actionType: 'block',
      priority: 10,
      conditionConfig: { patterns: ['ssn'] },
    });
    store.createRule(rule1);
    store.createRule(rule2);

    const result = await engine.evaluateContentSync(
      'SSN: 123-45-6789 Email: test@example.com',
      { tenantId: 'tenant-1', agentId: 'a1', toolName: 'test', direction: 'input' },
    );
    // Block takes precedence and short-circuits
    expect(result.decision).toBe('block');
    expect(result.blockingRuleId).toBe(rule2.id);
  });

  it('respects direction filter', async () => {
    const rule = makeRule({ direction: 'output' });
    store.createRule(rule);

    const result = await engine.evaluateContentSync('SSN: 123-45-6789', {
      tenantId: 'tenant-1', agentId: 'a1', toolName: 'test', direction: 'input',
    });
    expect(result.decision).toBe('allow');
  });

  it('respects toolNames filter', async () => {
    const rule = makeRule({ toolNames: ['other_tool'] });
    store.createRule(rule);

    const result = await engine.evaluateContentSync('SSN: 123-45-6789', {
      tenantId: 'tenant-1', agentId: 'a1', toolName: 'test', direction: 'input',
    });
    expect(result.decision).toBe('allow');
  });

  it('dryRun rules match but do not affect decision', async () => {
    const rule = makeRule({ dryRun: true, actionType: 'block' });
    store.createRule(rule);

    const result = await engine.evaluateContentSync('SSN: 123-45-6789', {
      tenantId: 'tenant-1', agentId: 'a1', toolName: 'test', direction: 'input',
    });
    expect(result.decision).toBe('allow');
    // Trigger should still be recorded
    const { triggers } = store.listTriggerHistory('tenant-1', { ruleId: rule.id });
    expect(triggers).toHaveLength(1);
  });

  it('returns allow for oversized content (> 1MB)', async () => {
    const rule = makeRule();
    store.createRule(rule);

    const result = await engine.evaluateContentSync('x'.repeat(1024 * 1024 + 1), {
      tenantId: 'tenant-1', agentId: 'a1', toolName: 'test', direction: 'input',
    });
    expect(result.decision).toBe('allow');
  });

  it('action conflict resolution: block > redact', async () => {
    const redactRule = makeRule({ actionType: 'redact', priority: 0, conditionConfig: { patterns: ['ssn'] } });
    const blockRule = makeRule({ actionType: 'block', priority: 10, conditionConfig: { patterns: ['ssn'] } });
    store.createRule(redactRule);
    store.createRule(blockRule);

    const result = await engine.evaluateContentSync('SSN: 123-45-6789', {
      tenantId: 'tenant-1', agentId: 'a1', toolName: 'test', direction: 'input',
    });
    expect(result.decision).toBe('block');
  });

  it('includes evaluationMs in result', async () => {
    const result = await engine.evaluateContentSync('hello', {
      tenantId: 'tenant-1', agentId: 'a1', toolName: 'test', direction: 'input',
    });
    expect(typeof result.evaluationMs).toBe('number');
  });
});
