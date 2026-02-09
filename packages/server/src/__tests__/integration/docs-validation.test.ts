/**
 * Documentation Validation Tests (Story 7.6) — ~5 tests
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';

const docsDir = resolve(__dirname, '../../../../..', 'docs');

describe('Documentation Validation (Story 7.6)', () => {
  const requiredDocs = [
    'sharing-setup.md',
    'privacy-controls.md',
    'discovery-delegation.md',
    'privacy-architecture.md',
    'redaction-plugin.md',
    'api-reference-v0.9.md',
  ];

  it('should have all required documentation files', () => {
    for (const doc of requiredDocs) {
      const path = resolve(docsDir, doc);
      expect(existsSync(path), `Missing doc: ${doc}`).toBe(true);
    }
  });

  it('should have non-empty documentation files', () => {
    for (const doc of requiredDocs) {
      const path = resolve(docsDir, doc);
      const content = readFileSync(path, 'utf-8');
      expect(content.length, `Doc ${doc} is empty`).toBeGreaterThan(100);
    }
  });

  it('should have proper headings in all docs', () => {
    for (const doc of requiredDocs) {
      const path = resolve(docsDir, doc);
      const content = readFileSync(path, 'utf-8');
      expect(content.startsWith('#'), `Doc ${doc} should start with a heading`).toBe(true);
    }
  });

  it('should reference API endpoints in api-reference doc', () => {
    const content = readFileSync(resolve(docsDir, 'api-reference-v0.9.md'), 'utf-8');
    const requiredEndpoints = [
      '/api/community/share',
      '/api/community/search',
      '/api/community/config',
      '/api/community/audit',
      '/api/agents/discover',
      '/api/delegation',
      '/api/trust',
    ];
    for (const endpoint of requiredEndpoints) {
      expect(content, `API doc should reference ${endpoint}`).toContain(endpoint);
    }
  });

  it('should document the 6 redaction layers in privacy-architecture', () => {
    const content = readFileSync(resolve(docsDir, 'privacy-architecture.md'), 'utf-8');
    const layers = [
      'SecretDetection',
      'PIIDetection',
      'URL',
      'TenantDeidentification',
      'DenyList',
      'HumanReview',
    ];
    for (const layer of layers) {
      expect(content.toLowerCase(), `Should document ${layer}`).toContain(layer.toLowerCase());
    }
  });
});
