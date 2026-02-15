/**
 * SH-3: Global Body Limit Middleware
 *
 * Applies a 1MB default body size limit to all API routes.
 * Individual routes can override with their own bodyLimit (e.g., events uses 10MB).
 */

import { bodyLimit } from 'hono/body-limit';

/** 1MB default body limit for API routes */
export const apiBodyLimit = bodyLimit({
  maxSize: 1 * 1024 * 1024, // 1MB
  onError: (c) => {
    return c.json(
      { error: 'Request body too large', status: 413, maxSize: '1MB' },
      413,
    );
  },
});
