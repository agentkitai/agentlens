/**
 * SH-3: Zod schemas for delegation endpoints
 */
import { z } from 'zod';
import { TASK_TYPES } from '@agentlensai/core';

const taskTypeEnum = z.enum(TASK_TYPES as unknown as [string, ...string[]]);

export const createDelegationSchema = z.object({
  agentId: z.string().min(1, 'agentId is required'),
  targetAnonymousId: z.string().min(1, 'targetAnonymousId is required'),
  taskType: taskTypeEnum,
  input: z.unknown().optional(),
  timeoutMs: z.number().int().min(1000).max(300000).optional(),
  fallbackEnabled: z.boolean().optional(),
  maxRetries: z.number().int().min(0).max(10).optional(),
});

export const rejectDelegationSchema = z.object({
  reason: z.string().max(1024).optional(),
});

export const completeDelegationSchema = z.object({
  output: z.unknown(),
});

export type CreateDelegationInput = z.infer<typeof createDelegationSchema>;
