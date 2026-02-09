/**
 * Tests for Capability Registry Store (Story 5.1)
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { createTestDb } from '../db/index.js';
import { runMigrations } from '../db/migrate.js';
import { CapabilityStore, ValidationError } from '../db/capability-store.js';
import type { SqliteDb } from '../db/index.js';

describe('CapabilityStore (Story 5.1)', () => {
  let db: SqliteDb;
  let store: CapabilityStore;

  const validInput = {
    taskType: 'translation',
    inputSchema: { type: 'object', properties: { text: { type: 'string' } } },
    outputSchema: { type: 'object', properties: { translated: { type: 'string' } } },
  };

  beforeEach(() => {
    db = createTestDb();
    runMigrations(db);
    store = new CapabilityStore(db);
  });

  // ─── Create ──────────────────────────────────────────────

  describe('create', () => {
    it('should create a capability with valid input', () => {
      const cap = store.create('tenant-1', 'agent-1', validInput);
      expect(cap.id).toBeDefined();
      expect(cap.tenantId).toBe('tenant-1');
      expect(cap.agentId).toBe('agent-1');
      expect(cap.taskType).toBe('translation');
      expect(cap.inputSchema).toEqual(validInput.inputSchema);
      expect(cap.outputSchema).toEqual(validInput.outputSchema);
    });

    it('should default scope to internal', () => {
      const cap = store.create('tenant-1', 'agent-1', validInput);
      expect(cap.scope).toBe('internal');
    });

    it('should allow scope=public', () => {
      const cap = store.create('tenant-1', 'agent-1', { ...validInput, scope: 'public' });
      expect(cap.scope).toBe('public');
    });

    it('should set createdAt and updatedAt', () => {
      const cap = store.create('tenant-1', 'agent-1', validInput);
      expect(cap.createdAt).toBeDefined();
      expect(cap.updatedAt).toBeDefined();
    });

    it('should generate unique IDs', () => {
      const c1 = store.create('tenant-1', 'agent-1', validInput);
      const c2 = store.create('tenant-1', 'agent-1', { ...validInput, taskType: 'summarization' });
      expect(c1.id).not.toBe(c2.id);
    });

    it('should allow agent to have multiple capabilities', () => {
      store.create('tenant-1', 'agent-1', validInput);
      store.create('tenant-1', 'agent-1', { ...validInput, taskType: 'summarization' });
      store.create('tenant-1', 'agent-1', { ...validInput, taskType: 'analysis' });
      const caps = store.listByAgent('tenant-1', 'agent-1');
      expect(caps).toHaveLength(3);
    });

    it('should store qualityMetrics as JSON', () => {
      const cap = store.create('tenant-1', 'agent-1', {
        ...validInput,
        qualityMetrics: { successRate: 0.95, avgLatencyMs: 200 },
      });
      expect(cap.qualityMetrics).toEqual({ successRate: 0.95, avgLatencyMs: 200 });
    });

    it('should default qualityMetrics to empty object', () => {
      const cap = store.create('tenant-1', 'agent-1', validInput);
      expect(cap.qualityMetrics).toEqual({});
    });

    it('should store optional numeric fields', () => {
      const cap = store.create('tenant-1', 'agent-1', {
        ...validInput,
        estimatedLatencyMs: 500,
        estimatedCostUsd: 0.01,
        maxInputBytes: 1024,
      });
      expect(cap.estimatedLatencyMs).toBe(500);
      expect(cap.estimatedCostUsd).toBe(0.01);
      expect(cap.maxInputBytes).toBe(1024);
    });

    it('should store customType', () => {
      const cap = store.create('tenant-1', 'agent-1', {
        ...validInput,
        taskType: 'custom',
        customType: 'my-custom-task',
      });
      expect(cap.customType).toBe('my-custom-task');
    });

    it('should default enabled to true', () => {
      const cap = store.create('tenant-1', 'agent-1', validInput);
      expect(cap.enabled).toBe(true);
    });

    it('should default acceptDelegations to false', () => {
      const cap = store.create('tenant-1', 'agent-1', validInput);
      expect(cap.acceptDelegations).toBe(false);
    });
  });

  // ─── Validation ──────────────────────────────────────────

  describe('validation', () => {
    it('should reject invalid taskType', () => {
      expect(() =>
        store.create('t', 'a', { ...validInput, taskType: 'invalid-type' }),
      ).toThrow(ValidationError);
    });

    it('should reject invalid taskType with descriptive message', () => {
      expect(() =>
        store.create('t', 'a', { ...validInput, taskType: 'bogus' }),
      ).toThrow(/Invalid taskType/);
    });

    it('should accept all valid task types', () => {
      const types = ['translation', 'summarization', 'code-review', 'data-extraction',
        'classification', 'generation', 'analysis', 'transformation', 'custom'];
      for (const tt of types) {
        const input = { ...validInput, taskType: tt };
        if (tt === 'custom') (input as Record<string, unknown>).customType = 'my-type';
        expect(() => store.create('t', 'a', input)).not.toThrow();
      }
    });

    it('should reject customType longer than 64 chars', () => {
      expect(() =>
        store.create('t', 'a', {
          ...validInput,
          taskType: 'custom',
          customType: 'a'.repeat(65),
        }),
      ).toThrow(ValidationError);
    });

    it('should reject customType with spaces', () => {
      expect(() =>
        store.create('t', 'a', {
          ...validInput,
          taskType: 'custom',
          customType: 'has space',
        }),
      ).toThrow(ValidationError);
    });

    it('should reject customType with special characters', () => {
      expect(() =>
        store.create('t', 'a', {
          ...validInput,
          taskType: 'custom',
          customType: 'has_underscore',
        }),
      ).toThrow(ValidationError);
    });

    it('should accept customType with hyphens and alphanumeric', () => {
      expect(() =>
        store.create('t', 'a', {
          ...validInput,
          taskType: 'custom',
          customType: 'my-custom-type-123',
        }),
      ).not.toThrow();
    });

    it('should require customType when taskType is custom', () => {
      expect(() =>
        store.create('t', 'a', { ...validInput, taskType: 'custom' }),
      ).toThrow(ValidationError);
    });

    it('should reject null inputSchema', () => {
      expect(() =>
        store.create('t', 'a', { ...validInput, inputSchema: null as unknown as Record<string, unknown> }),
      ).toThrow(ValidationError);
    });

    it('should reject array inputSchema', () => {
      expect(() =>
        store.create('t', 'a', { ...validInput, inputSchema: [] as unknown as Record<string, unknown> }),
      ).toThrow(ValidationError);
    });

    it('should reject inputSchema without type or schema keyword', () => {
      expect(() =>
        store.create('t', 'a', { ...validInput, inputSchema: { foo: 'bar' } }),
      ).toThrow(ValidationError);
    });

    it('should accept inputSchema with properties keyword', () => {
      expect(() =>
        store.create('t', 'a', { ...validInput, inputSchema: { properties: { x: {} } } }),
      ).not.toThrow();
    });

    it('should reject null outputSchema', () => {
      expect(() =>
        store.create('t', 'a', { ...validInput, outputSchema: null as unknown as Record<string, unknown> }),
      ).toThrow(ValidationError);
    });

    it('should reject invalid scope', () => {
      expect(() =>
        store.create('t', 'a', { ...validInput, scope: 'invalid' as 'internal' }),
      ).toThrow(ValidationError);
    });

    it('should accept schema with $ref', () => {
      expect(() =>
        store.create('t', 'a', { ...validInput, inputSchema: { $ref: '#/defs/Foo' } }),
      ).not.toThrow();
    });

    it('should accept schema with oneOf', () => {
      expect(() =>
        store.create('t', 'a', { ...validInput, inputSchema: { oneOf: [{ type: 'string' }] } }),
      ).not.toThrow();
    });

    it('should accept schema with enum', () => {
      expect(() =>
        store.create('t', 'a', { ...validInput, inputSchema: { enum: ['a', 'b'] } }),
      ).not.toThrow();
    });
  });

  // ─── Read ────────────────────────────────────────────────

  describe('getById', () => {
    it('should return capability by ID', () => {
      const created = store.create('t1', 'a1', validInput);
      const fetched = store.getById('t1', created.id);
      expect(fetched).toBeDefined();
      expect(fetched!.id).toBe(created.id);
    });

    it('should return null for non-existent ID', () => {
      expect(store.getById('t1', 'nonexistent')).toBeNull();
    });

    it('should enforce tenant isolation on getById', () => {
      const created = store.create('t1', 'a1', validInput);
      expect(store.getById('t2', created.id)).toBeNull();
    });
  });

  describe('listByAgent', () => {
    it('should list capabilities for an agent', () => {
      store.create('t1', 'a1', validInput);
      store.create('t1', 'a1', { ...validInput, taskType: 'summarization' });
      const caps = store.listByAgent('t1', 'a1');
      expect(caps).toHaveLength(2);
    });

    it('should return empty array for agent with no capabilities', () => {
      expect(store.listByAgent('t1', 'a1')).toEqual([]);
    });

    it('should enforce tenant isolation on listByAgent', () => {
      store.create('t1', 'a1', validInput);
      expect(store.listByAgent('t2', 'a1')).toEqual([]);
    });

    it('should not return other agents capabilities', () => {
      store.create('t1', 'a1', validInput);
      store.create('t1', 'a2', { ...validInput, taskType: 'analysis' });
      expect(store.listByAgent('t1', 'a1')).toHaveLength(1);
      expect(store.listByAgent('t1', 'a2')).toHaveLength(1);
    });
  });

  // ─── Update ──────────────────────────────────────────────

  describe('update', () => {
    it('should update taskType', () => {
      const cap = store.create('t1', 'a1', validInput);
      const updated = store.update('t1', cap.id, { taskType: 'summarization' });
      expect(updated.taskType).toBe('summarization');
    });

    it('should update inputSchema', () => {
      const cap = store.create('t1', 'a1', validInput);
      const newSchema = { type: 'object', properties: { content: { type: 'string' } } };
      const updated = store.update('t1', cap.id, { inputSchema: newSchema });
      expect(updated.inputSchema).toEqual(newSchema);
    });

    it('should reject invalid update', () => {
      const cap = store.create('t1', 'a1', validInput);
      expect(() => store.update('t1', cap.id, { taskType: 'invalid' })).toThrow(ValidationError);
    });

    it('should throw NotFoundError for non-existent capability', () => {
      expect(() => store.update('t1', 'nonexistent', { taskType: 'analysis' })).toThrow(/not found/);
    });

    it('should update updatedAt timestamp', async () => {
      const cap = store.create('t1', 'a1', validInput);
      await new Promise((r) => setTimeout(r, 10));
      const updated = store.update('t1', cap.id, { scope: 'public' });
      expect(updated.updatedAt >= cap.updatedAt).toBe(true);
    });

    it('should enforce tenant isolation on update', () => {
      const cap = store.create('t1', 'a1', validInput);
      expect(() => store.update('t2', cap.id, { taskType: 'analysis' })).toThrow(/not found/);
    });
  });

  // ─── Delete ──────────────────────────────────────────────

  describe('delete', () => {
    it('should delete a capability', () => {
      const cap = store.create('t1', 'a1', validInput);
      const result = store.delete('t1', cap.id);
      expect(result).toBe(true);
      expect(store.getById('t1', cap.id)).toBeNull();
    });

    it('should return false for non-existent capability', () => {
      expect(store.delete('t1', 'nonexistent')).toBe(false);
    });

    it('should enforce tenant isolation on delete', () => {
      const cap = store.create('t1', 'a1', validInput);
      expect(store.delete('t2', cap.id)).toBe(false);
      expect(store.getById('t1', cap.id)).not.toBeNull();
    });
  });

  describe('deleteByAgent', () => {
    it('should delete all capabilities for an agent', () => {
      store.create('t1', 'a1', validInput);
      store.create('t1', 'a1', { ...validInput, taskType: 'summarization' });
      const count = store.deleteByAgent('t1', 'a1');
      expect(count).toBe(2);
      expect(store.listByAgent('t1', 'a1')).toEqual([]);
    });

    it('should not delete other agent capabilities', () => {
      store.create('t1', 'a1', validInput);
      store.create('t1', 'a2', { ...validInput, taskType: 'analysis' });
      store.deleteByAgent('t1', 'a1');
      expect(store.listByAgent('t1', 'a2')).toHaveLength(1);
    });
  });
});
