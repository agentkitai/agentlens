/**
 * Capability Registry Store (Story 5.1)
 *
 * CRUD operations for the capability_registry table with tenant isolation.
 */

import { randomUUID } from 'node:crypto';
import { eq, and } from 'drizzle-orm';
import type { SqliteDb } from './index.js';
import { capabilityRegistry } from './schema.sqlite.js';
import { TASK_TYPES, type TaskType, type CapabilityRegistration } from '@agentlensai/core';
import { NotFoundError } from './errors.js';

/** Valid task types as a Set for fast lookup */
const VALID_TASK_TYPES = new Set<string>(TASK_TYPES);

/** Regex for customType validation: alphanumeric + hyphens, max 64 chars */
const CUSTOM_TYPE_REGEX = /^[a-zA-Z0-9-]{1,64}$/;

/** DB row type */
type CapabilityRow = typeof capabilityRegistry.$inferSelect;

/** Input for creating/updating a capability */
export interface CapabilityInput {
  taskType: string;
  customType?: string;
  inputSchema: Record<string, unknown>;
  outputSchema: Record<string, unknown>;
  inputMimeTypes?: string[];
  outputMimeTypes?: string[];
  qualityMetrics?: Record<string, unknown>;
  estimatedLatencyMs?: number;
  estimatedCostUsd?: number;
  maxInputBytes?: number;
  scope?: 'internal' | 'public';
}

/** Parsed capability returned from store */
export interface Capability {
  id: string;
  tenantId: string;
  agentId: string;
  taskType: TaskType;
  customType?: string;
  inputSchema: Record<string, unknown>;
  outputSchema: Record<string, unknown>;
  qualityMetrics: Record<string, unknown>;
  estimatedLatencyMs?: number;
  estimatedCostUsd?: number;
  maxInputBytes?: number;
  scope: 'internal' | 'public';
  enabled: boolean;
  acceptDelegations: boolean;
  inboundRateLimit: number;
  outboundRateLimit: number;
  createdAt: string;
  updatedAt: string;
}

function rowToCapability(row: CapabilityRow): Capability {
  return {
    id: row.id,
    tenantId: row.tenantId,
    agentId: row.agentId,
    taskType: row.taskType as TaskType,
    customType: row.customType ?? undefined,
    inputSchema: JSON.parse(row.inputSchema) as Record<string, unknown>,
    outputSchema: JSON.parse(row.outputSchema) as Record<string, unknown>,
    qualityMetrics: JSON.parse(row.qualityMetrics) as Record<string, unknown>,
    estimatedLatencyMs: row.estimatedLatencyMs ?? undefined,
    estimatedCostUsd: row.estimatedCostUsd ?? undefined,
    maxInputBytes: row.maxInputBytes ?? undefined,
    scope: row.scope as 'internal' | 'public',
    enabled: row.enabled,
    acceptDelegations: row.acceptDelegations,
    inboundRateLimit: row.inboundRateLimit,
    outboundRateLimit: row.outboundRateLimit,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/**
 * Validate a JSON Schema object (basic validation).
 * Must be a non-null object with a "type" property.
 */
function validateJsonSchema(schema: unknown, label: string): void {
  if (schema === null || schema === undefined || typeof schema !== 'object' || Array.isArray(schema)) {
    throw new ValidationError(`${label} must be a JSON Schema object`);
  }
  const s = schema as Record<string, unknown>;
  if (!s.type && !s.$ref && !s.oneOf && !s.anyOf && !s.allOf && !s.properties && !s.enum) {
    throw new ValidationError(`${label} must be a valid JSON Schema (missing type or schema keyword)`);
  }
}

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

export class CapabilityStore {
  constructor(private readonly db: SqliteDb) {}

  /**
   * Validate capability input and throw ValidationError on problems.
   */
  private validate(input: CapabilityInput): void {
    // Validate taskType
    if (!VALID_TASK_TYPES.has(input.taskType)) {
      throw new ValidationError(
        `Invalid taskType "${input.taskType}". Must be one of: ${TASK_TYPES.join(', ')}`,
      );
    }

    // Validate customType format if provided
    if (input.customType !== undefined && input.customType !== null) {
      if (!CUSTOM_TYPE_REGEX.test(input.customType)) {
        throw new ValidationError(
          'customType must be 1-64 characters, alphanumeric and hyphens only',
        );
      }
    }

    // customType is required when taskType is 'custom'
    if (input.taskType === 'custom' && !input.customType) {
      throw new ValidationError('customType is required when taskType is "custom"');
    }

    // Validate input/output schemas
    validateJsonSchema(input.inputSchema, 'inputSchema');
    validateJsonSchema(input.outputSchema, 'outputSchema');

    // Validate scope if provided
    if (input.scope !== undefined && input.scope !== 'internal' && input.scope !== 'public') {
      throw new ValidationError('scope must be "internal" or "public"');
    }
  }

  /**
   * Create a new capability registration.
   */
  create(tenantId: string, agentId: string, input: CapabilityInput): Capability {
    this.validate(input);

    const now = new Date().toISOString();
    const id = randomUUID();

    this.db
      .insert(capabilityRegistry)
      .values({
        id,
        tenantId,
        agentId,
        taskType: input.taskType,
        customType: input.customType ?? null,
        inputSchema: JSON.stringify(input.inputSchema),
        outputSchema: JSON.stringify(input.outputSchema),
        qualityMetrics: JSON.stringify(input.qualityMetrics ?? {}),
        estimatedLatencyMs: input.estimatedLatencyMs ?? null,
        estimatedCostUsd: input.estimatedCostUsd ?? null,
        maxInputBytes: input.maxInputBytes ?? null,
        scope: input.scope ?? 'internal',
        createdAt: now,
        updatedAt: now,
      })
      .run();

    return this.getById(tenantId, id)!;
  }

  /**
   * Get a capability by ID (tenant-scoped).
   */
  getById(tenantId: string, id: string): Capability | null {
    const row = this.db
      .select()
      .from(capabilityRegistry)
      .where(and(eq(capabilityRegistry.id, id), eq(capabilityRegistry.tenantId, tenantId)))
      .get();
    return row ? rowToCapability(row) : null;
  }

  /**
   * List all capabilities for an agent (tenant-scoped).
   */
  listByTenant(tenantId: string, opts?: { taskType?: string; agentId?: string }): Capability[] {
    let rows = this.db
      .select()
      .from(capabilityRegistry)
      .where(eq(capabilityRegistry.tenantId, tenantId))
      .all();
    if (opts?.taskType) {
      rows = rows.filter((r) => r.taskType === opts.taskType);
    }
    if (opts?.agentId) {
      rows = rows.filter((r) => r.agentId === opts.agentId);
    }
    return rows.map(rowToCapability);
  }

  listByAgent(tenantId: string, agentId: string): Capability[] {
    const rows = this.db
      .select()
      .from(capabilityRegistry)
      .where(
        and(
          eq(capabilityRegistry.tenantId, tenantId),
          eq(capabilityRegistry.agentId, agentId),
        ),
      )
      .all();
    return rows.map(rowToCapability);
  }

  /**
   * Update a capability by ID (tenant-scoped).
   */
  update(tenantId: string, id: string, input: Partial<CapabilityInput>): Capability {
    const existing = this.getById(tenantId, id);
    if (!existing) {
      throw new NotFoundError(`Capability ${id} not found`);
    }

    // Merge with existing for validation
    const merged: CapabilityInput = {
      taskType: input.taskType ?? existing.taskType,
      customType: input.customType !== undefined ? input.customType : existing.customType,
      inputSchema: input.inputSchema ?? existing.inputSchema,
      outputSchema: input.outputSchema ?? existing.outputSchema,
      scope: input.scope ?? existing.scope,
    };
    this.validate(merged);

    const updates: Record<string, unknown> = { updatedAt: new Date().toISOString() };
    if (input.taskType !== undefined) updates.taskType = input.taskType;
    if (input.customType !== undefined) updates.customType = input.customType;
    if (input.inputSchema !== undefined) updates.inputSchema = JSON.stringify(input.inputSchema);
    if (input.outputSchema !== undefined) updates.outputSchema = JSON.stringify(input.outputSchema);
    if (input.qualityMetrics !== undefined) updates.qualityMetrics = JSON.stringify(input.qualityMetrics);
    if (input.estimatedLatencyMs !== undefined) updates.estimatedLatencyMs = input.estimatedLatencyMs;
    if (input.estimatedCostUsd !== undefined) updates.estimatedCostUsd = input.estimatedCostUsd;
    if (input.maxInputBytes !== undefined) updates.maxInputBytes = input.maxInputBytes;
    if (input.scope !== undefined) updates.scope = input.scope;
    // Allow toggling enabled/acceptDelegations via partial update
    const extra = input as Record<string, unknown>;
    if (extra.enabled !== undefined) updates.enabled = Boolean(extra.enabled);
    if (extra.acceptDelegations !== undefined) updates.acceptDelegations = Boolean(extra.acceptDelegations);

    this.db
      .update(capabilityRegistry)
      .set(updates)
      .where(and(eq(capabilityRegistry.id, id), eq(capabilityRegistry.tenantId, tenantId)))
      .run();

    return this.getById(tenantId, id)!;
  }

  /**
   * Delete a capability by ID (tenant-scoped).
   */
  delete(tenantId: string, id: string): boolean {
    const result = this.db
      .delete(capabilityRegistry)
      .where(and(eq(capabilityRegistry.id, id), eq(capabilityRegistry.tenantId, tenantId)))
      .run();
    return result.changes > 0;
  }

  /**
   * Delete all capabilities for an agent (tenant-scoped).
   */
  deleteByAgent(tenantId: string, agentId: string): number {
    const result = this.db
      .delete(capabilityRegistry)
      .where(
        and(
          eq(capabilityRegistry.tenantId, tenantId),
          eq(capabilityRegistry.agentId, agentId),
        ),
      )
      .run();
    return result.changes;
  }
}
