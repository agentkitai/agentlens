/**
 * SH-3: Zod schemas for discovery endpoints
 */
import { z } from 'zod';

export const updateDiscoveryConfigSchema = z.object({
  minTrustThreshold: z.number().min(0).max(100).optional(),
  delegationEnabled: z.boolean().optional(),
});

export const updateCapabilityPermissionsSchema = z.object({
  enabled: z.boolean().optional(),
  acceptDelegations: z.boolean().optional(),
  inboundRateLimit: z.number().int().min(0).optional(),
  outboundRateLimit: z.number().int().min(0).optional(),
});

export type UpdateDiscoveryConfigInput = z.infer<typeof updateDiscoveryConfigSchema>;
export type UpdateCapabilityPermissionsInput = z.infer<typeof updateCapabilityPermissionsSchema>;
