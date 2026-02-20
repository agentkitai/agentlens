/**
 * Tests for PromptStore (Feature 19 — Story 3)
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { createTestDb, type SqliteDb } from '../index.js';
import { runMigrations } from '../migrate.js';
import {
  PromptStore,
  normalizePromptContent,
  computePromptHash,
  type CreateTemplateInput,
} from '../prompt-store.js';

let db: SqliteDb;
let store: PromptStore;

beforeEach(() => {
  db = createTestDb();
  runMigrations(db);
  store = new PromptStore(db);
});

const TENANT = 'test-tenant';

function makeInput(overrides: Partial<CreateTemplateInput> = {}): CreateTemplateInput {
  return {
    name: 'Test Template',
    content: 'Hello {{user}}, welcome to {{app}}!',
    description: 'A test template',
    category: 'greeting',
    variables: [
      { name: 'user', required: true },
      { name: 'app', defaultValue: 'AgentLens' },
    ],
    ...overrides,
  };
}

// ─── Normalization & Hashing ───────────────────────────────

describe('normalizePromptContent', () => {
  it('normalizes line endings', () => {
    expect(normalizePromptContent('a\r\nb')).toBe('a\nb');
  });

  it('trims trailing whitespace per line', () => {
    expect(normalizePromptContent('hello   \nworld\t\n')).toBe('hello\nworld');
  });

  it('collapses excessive newlines', () => {
    expect(normalizePromptContent('a\n\n\n\nb')).toBe('a\n\nb');
  });

  it('trims leading/trailing', () => {
    expect(normalizePromptContent('  hello  ')).toBe('hello');
  });
});

describe('computePromptHash', () => {
  it('produces stable hash', () => {
    const h1 = computePromptHash('hello world');
    const h2 = computePromptHash('hello world');
    expect(h1).toBe(h2);
    expect(h1).toHaveLength(64); // SHA-256 hex
  });

  it('same hash for content differing only in whitespace', () => {
    const h1 = computePromptHash('hello world  \n');
    const h2 = computePromptHash('hello world\n');
    expect(h1).toBe(h2);
  });
});

// ─── Template CRUD ─────────────────────────────────────────

describe('PromptStore — createTemplate', () => {
  it('creates template with version 1', () => {
    const { template, version } = store.createTemplate(TENANT, makeInput());

    expect(template.id).toBeDefined();
    expect(template.name).toBe('Test Template');
    expect(template.category).toBe('greeting');
    expect(template.currentVersionId).toBe(version.id);
    expect(template.currentVersionNumber).toBe(1);

    expect(version.versionNumber).toBe(1);
    expect(version.content).toBe('Hello {{user}}, welcome to {{app}}!');
    expect(version.variables).toHaveLength(2);
    expect(version.contentHash).toHaveLength(64);
  });
});

describe('PromptStore — getTemplate', () => {
  it('returns template', () => {
    const { template } = store.createTemplate(TENANT, makeInput());
    const result = store.getTemplate(template.id, TENANT);
    expect(result).not.toBeNull();
    expect(result!.name).toBe('Test Template');
  });

  it('returns null for non-existent', () => {
    expect(store.getTemplate('nope', TENANT)).toBeNull();
  });

  it('returns null for deleted template', () => {
    const { template } = store.createTemplate(TENANT, makeInput());
    store.softDeleteTemplate(template.id, TENANT);
    expect(store.getTemplate(template.id, TENANT)).toBeNull();
  });

  it('enforces tenant isolation', () => {
    const { template } = store.createTemplate(TENANT, makeInput());
    expect(store.getTemplate(template.id, 'other-tenant')).toBeNull();
  });
});

describe('PromptStore — listTemplates', () => {
  it('lists templates with pagination', () => {
    store.createTemplate(TENANT, makeInput({ name: 'A' }));
    store.createTemplate(TENANT, makeInput({ name: 'B' }));
    store.createTemplate(TENANT, makeInput({ name: 'C' }));

    const { templates, total } = store.listTemplates({ tenantId: TENANT, limit: 2 });
    expect(total).toBe(3);
    expect(templates).toHaveLength(2);
  });

  it('filters by category', () => {
    store.createTemplate(TENANT, makeInput({ name: 'A', category: 'system' }));
    store.createTemplate(TENANT, makeInput({ name: 'B', category: 'greeting' }));

    const { templates, total } = store.listTemplates({ tenantId: TENANT, category: 'system' });
    expect(total).toBe(1);
    expect(templates[0].name).toBe('A');
  });

  it('filters by search', () => {
    store.createTemplate(TENANT, makeInput({ name: 'My System Prompt' }));
    store.createTemplate(TENANT, makeInput({ name: 'Greeting' }));

    const { templates } = store.listTemplates({ tenantId: TENANT, search: 'System' });
    expect(templates).toHaveLength(1);
    expect(templates[0].name).toBe('My System Prompt');
  });
});

describe('PromptStore — softDeleteTemplate', () => {
  it('soft deletes', () => {
    const { template } = store.createTemplate(TENANT, makeInput());
    const deleted = store.softDeleteTemplate(template.id, TENANT);
    expect(deleted).toBe(true);

    const { total } = store.listTemplates({ tenantId: TENANT });
    expect(total).toBe(0);
  });
});

// ─── Version Management ────────────────────────────────────

describe('PromptStore — createVersion', () => {
  it('creates version 2', () => {
    const { template } = store.createTemplate(TENANT, makeInput());
    const v2 = store.createVersion(template.id, TENANT, {
      content: 'Updated content',
      changelog: 'Changed wording',
    });

    expect(v2).not.toBeNull();
    expect(v2!.versionNumber).toBe(2);
    expect(v2!.content).toBe('Updated content');
    expect(v2!.changelog).toBe('Changed wording');
  });

  it('skips duplicate content (dedup)', () => {
    const { template, version: v1 } = store.createTemplate(TENANT, makeInput());
    const v2 = store.createVersion(template.id, TENANT, {
      content: makeInput().content, // same content
    });

    // Should return existing version (no new version created)
    expect(v2).not.toBeNull();
    expect(v2!.versionNumber).toBe(1);
    expect(v2!.id).toBe(v1.id);
  });

  it('returns null for non-existent template', () => {
    const result = store.createVersion('nope', TENANT, { content: 'test' });
    expect(result).toBeNull();
  });
});

describe('PromptStore — listVersions', () => {
  it('lists versions descending', () => {
    const { template } = store.createTemplate(TENANT, makeInput());
    store.createVersion(template.id, TENANT, { content: 'v2 content' });
    store.createVersion(template.id, TENANT, { content: 'v3 content' });

    const versions = store.listVersions(template.id, TENANT);
    expect(versions).toHaveLength(3);
    expect(versions[0].versionNumber).toBe(3);
    expect(versions[2].versionNumber).toBe(1);
  });
});

// ─── Fingerprinting ────────────────────────────────────────

describe('PromptStore — fingerprints', () => {
  it('upserts and increments', () => {
    store.upsertFingerprint('abc123', TENANT, 'agent-1', 'Sample content');
    store.upsertFingerprint('abc123', TENANT, 'agent-1', 'Sample content');

    const fps = store.getFingerprints(TENANT);
    expect(fps).toHaveLength(1);
    expect(fps[0].callCount).toBe(2);
    expect(fps[0].sampleContent).toBe('Sample content');
  });

  it('filters by agentId', () => {
    store.upsertFingerprint('hash1', TENANT, 'agent-1', 'content1');
    store.upsertFingerprint('hash2', TENANT, 'agent-2', 'content2');

    const fps = store.getFingerprints(TENANT, 'agent-1');
    expect(fps).toHaveLength(1);
    expect(fps[0].agentId).toBe('agent-1');
  });

  it('links to template', () => {
    const { template } = store.createTemplate(TENANT, makeInput());
    store.upsertFingerprint('hash1', TENANT, 'agent-1', 'content1');

    const linked = store.linkFingerprintToTemplate('hash1', TENANT, template.id);
    expect(linked).toBe(true);

    const fps = store.getFingerprints(TENANT);
    expect(fps[0].templateId).toBe(template.id);
  });
});

// ─── Analytics ─────────────────────────────────────────────

describe('PromptStore — getVersionAnalytics', () => {
  it('returns zero metrics for template with no events', () => {
    const { template } = store.createTemplate(TENANT, makeInput());
    const analytics = store.getVersionAnalytics(template.id, TENANT);

    expect(analytics).toHaveLength(1);
    expect(analytics[0].callCount).toBe(0);
    expect(analytics[0].totalCostUsd).toBe(0);
  });
});
