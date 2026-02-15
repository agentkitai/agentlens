/**
 * SH-3: Zod schemas for API key endpoints
 */
import { z } from 'zod';

export const createApiKeySchema = z.object({
  name: z.string().min(1).max(255).optional(),
  scopes: z.array(z.string().min(1).max(64)).max(50).optional(),
  tenantId: z.string().min(1).max(128).optional(),
});

export type CreateApiKeyInput = z.infer<typeof createApiKeySchema>;
