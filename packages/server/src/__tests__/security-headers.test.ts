import { describe, it, expect } from 'vitest';
import { createTestApp } from './test-helpers.js';

describe('SH-5: Security Headers', () => {
  it('should include all required security headers on API responses', async () => {
    const { app } = await createTestApp({ authDisabled: true });
    const res = await app.request('/api/health');

    expect(res.status).toBe(200);

    // Snapshot all security headers
    const securityHeaders = {
      'content-security-policy': res.headers.get('content-security-policy'),
      'x-content-type-options': res.headers.get('x-content-type-options'),
      'x-frame-options': res.headers.get('x-frame-options'),
      'referrer-policy': res.headers.get('referrer-policy'),
      'strict-transport-security': res.headers.get('strict-transport-security'),
      'permissions-policy': res.headers.get('permissions-policy'),
    };

    expect(securityHeaders).toMatchSnapshot();
  });

  it('should include security headers on non-API routes', async () => {
    const { app } = await createTestApp({ authDisabled: true });
    const res = await app.request('/nonexistent');

    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('x-frame-options')).toBe('DENY');
  });

  it('should have correct CSP directives', async () => {
    const { app } = await createTestApp({ authDisabled: true });
    const res = await app.request('/api/health');
    const csp = res.headers.get('content-security-policy')!;

    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("script-src 'self'");
    expect(csp).toContain("style-src 'self' 'unsafe-inline'");
    expect(csp).toContain("img-src 'self' data:");
    expect(csp).toContain("connect-src 'self'");
    expect(csp).toContain("font-src 'self'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("frame-ancestors 'none'");
  });
});
