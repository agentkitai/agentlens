/**
 * Red-Team Tests (Story 2.4)
 * Automated de-anonymization and correlation attacks
 */

import { describe, it, expect } from 'vitest';
import { RedactionPipeline } from '../pipeline.js';
import { createRawLessonContent } from '@agentlensai/core';
import type { RedactionContext } from '@agentlensai/core';

const pipeline = new RedactionPipeline();

function makeCtx(overrides: Partial<RedactionContext> = {}): RedactionContext {
  return {
    tenantId: 'acme-corp-2024',
    agentId: 'agent-codex-prime-v3',
    category: 'general',
    denyListPatterns: [],
    knownTenantTerms: ['AcmeCorp', 'Codex Prime', 'Project Aurora', 'InternalDB'],
    ...overrides,
  };
}

async function redact(title: string, content: string, ctx?: RedactionContext) {
  const raw = createRawLessonContent(title, content, {
    tenantId: 'acme-corp-2024',
    agentId: 'agent-codex-prime-v3',
    secretInfo: 'should-be-stripped',
  });
  const result = await pipeline.process(raw, ctx ?? makeCtx());
  if (result.status !== 'redacted') throw new Error(`Expected redacted, got ${result.status}`);
  return result;
}

// ═══════════════════════════════════════════════════════════
// De-anonymization Attack Tests
// ═══════════════════════════════════════════════════════════

describe('Red Team: Tenant Identity Recovery', () => {
  it('cannot recover tenant ID from redacted output', async () => {
    const r = await redact(
      'AcmeCorp Deployment Guide',
      'AcmeCorp uses this pattern for deploying to acme-corp-2024 infrastructure.'
    );
    expect(r.content.title).not.toContain('AcmeCorp');
    expect(r.content.content).not.toContain('AcmeCorp');
    expect(r.content.content).not.toContain('acme-corp-2024');
  });

  it('cannot recover tenant from domain references', async () => {
    const r = await redact(
      'Setup',
      'Configure DNS for api.acmecorp.internal and deploy to https://acmecorp.corp/dashboard',
    );
    expect(r.content.content).not.toContain('acmecorp');
  });

  it('cannot recover tenant from error messages', async () => {
    const r = await redact(
      'Error Handling',
      'AcmeCorp AuthService threw error: tenant acme-corp-2024 not authorized for Project Aurora'
    );
    expect(r.content.content).not.toContain('AcmeCorp');
    expect(r.content.content).not.toContain('acme-corp-2024');
    expect(r.content.content).not.toContain('Project Aurora');
  });

  it('cannot recover tenant from log snippets', async () => {
    const r = await redact(
      'Logging Pattern',
      '[2024-01-15] AcmeCorp/agent-codex-prime-v3: Processing request for tenant acme-corp-2024'
    );
    expect(r.content.content).not.toContain('AcmeCorp');
    expect(r.content.content).not.toContain('agent-codex-prime-v3');
    expect(r.content.content).not.toContain('acme-corp-2024');
  });

  it('cannot recover tenant from database references', async () => {
    const r = await redact(
      'DB Pattern',
      'SELECT * FROM acme_corp.users WHERE tenant = "acme-corp-2024"'
    );
    expect(r.content.content).not.toContain('acme-corp-2024');
  });

  it('cannot recover tenant from file paths', async () => {
    const r = await redact(
      'Deploy',
      'Configs stored at /opt/AcmeCorp/config.yml and /home/acme-deploy/scripts/'
    );
    expect(r.content.content).not.toContain('AcmeCorp');
  });
});

describe('Red Team: Agent ID Recovery', () => {
  it('cannot recover agent ID from redacted output', async () => {
    const r = await redact(
      'Agent Pattern',
      'agent-codex-prime-v3 learned that retry logic improves reliability'
    );
    expect(r.content.content).not.toContain('agent-codex-prime-v3');
  });

  it('cannot recover agent ID from UUID references', async () => {
    const r = await redact(
      'Agent Status',
      'Agent 550e8400-e29b-41d4-a716-446655440000 completed 100 tasks'
    );
    expect(r.content.content).not.toContain('550e8400');
  });

  it('anonymous IDs do not contain real agent IDs', async () => {
    const r = await redact(
      'Pattern',
      'agent-codex-prime-v3 ID: 550e8400-e29b-41d4-a716-446655440000'
    );
    // Real IDs should be replaced with [TENANT_ENTITY]
    expect(r.content.content).not.toContain('agent-codex-prime');
    expect(r.content.content).not.toContain('550e8400');
  });

  it('agent name in various contexts is stripped', async () => {
    const ctx = makeCtx({ knownTenantTerms: ['AcmeCorp', 'Codex Prime', 'Project Aurora', 'InternalDB', 'codex-prime'] });
    const r = await redact(
      'Config',
      'The codex-prime agent (Codex Prime) handles all requests',
      ctx,
    );
    expect(r.content.content).not.toContain('codex-prime');
    expect(r.content.content).not.toContain('Codex Prime');
  });
});

describe('Red Team: Cross-lesson Correlation', () => {
  it('cannot correlate lessons by consistent UUID patterns', async () => {
    const r1 = await redact('Pattern 1', 'Agent 550e8400-e29b-41d4-a716-446655440000 learned X');
    const r2 = await redact('Pattern 2', 'Agent 550e8400-e29b-41d4-a716-446655440000 learned Y');
    // Both should have the UUID replaced — an attacker can't match them
    expect(r1.content.content).not.toContain('550e8400');
    expect(r2.content.content).not.toContain('550e8400');
  });

  it('cannot correlate lessons by tenant name', async () => {
    const r1 = await redact('Lesson 1', 'AcmeCorp found that caching improves perf');
    const r2 = await redact('Lesson 2', 'AcmeCorp discovered that retries help');
    expect(r1.content.content).not.toContain('AcmeCorp');
    expect(r2.content.content).not.toContain('AcmeCorp');
  });

  it('cannot correlate lessons by internal URLs', async () => {
    const r1 = await redact('API 1', 'Connected to http://api.acmecorp.internal:8080');
    const r2 = await redact('API 2', 'Used http://api.acmecorp.internal:8080/v2');
    // Both should be [INTERNAL_URL]
    expect(r1.content.content).not.toContain('acmecorp.internal');
    expect(r2.content.content).not.toContain('acmecorp.internal');
  });

  it('cannot correlate by email domain', async () => {
    const r1 = await redact('Contact 1', 'Email dev@acmecorp.com');
    const r2 = await redact('Contact 2', 'Email ops@acmecorp.com');
    expect(r1.content.content).not.toContain('acmecorp.com');
    expect(r2.content.content).not.toContain('acmecorp.com');
  });
});

describe('Red Team: Partial Redaction Extraction', () => {
  it('secrets are fully replaced, not partially masked', async () => {
    const r = await redact(
      'Keys',
      'API key: sk-abc123def456ghi789jklmnopqrstuvwxyz'
    );
    // No partial key remnants
    expect(r.content.content).not.toMatch(/sk-[a-z]/);
    expect(r.content.content).not.toContain('abc123');
  });

  it('emails are fully replaced', async () => {
    const r = await redact('Contact', 'Email: admin@secretcorp.com');
    expect(r.content.content).not.toContain('admin');
    expect(r.content.content).not.toContain('secretcorp');
  });

  it('connection strings are fully replaced', async () => {
    const r = await redact(
      'DB',
      'postgres://admin:supersecret@db.internal:5432/production'
    );
    expect(r.content.content).not.toContain('admin:supersecret');
    expect(r.content.content).not.toContain('db.internal');
  });

  it('file paths are fully replaced', async () => {
    const r = await redact('Config', 'Edit /home/john.smith/.ssh/id_rsa');
    expect(r.content.content).not.toContain('john.smith');
    expect(r.content.content).not.toContain('.ssh/id_rsa');
  });

  it('phone numbers are fully replaced', async () => {
    const r = await redact('Contact', 'Call +1-555-867-5309');
    expect(r.content.content).not.toContain('867-5309');
    expect(r.content.content).not.toContain('555');
  });

  it('SSNs are fully replaced', async () => {
    const r = await redact('Record', 'SSN: 123-45-6789');
    expect(r.content.content).not.toContain('6789');
    expect(r.content.content).not.toContain('123-45');
  });
});

describe('Red Team: Context Field Stripping', () => {
  it('context is always empty object after pipeline', async () => {
    const r = await redact('Title', 'Content');
    expect(r.content.context).toEqual({});
  });

  it('context with secret data is stripped', async () => {
    const raw = createRawLessonContent('Title', 'Content', {
      tenantId: 'acme-corp-2024',
      agentId: 'agent-codex-prime-v3',
      apiKey: 'sk-abc123def456ghi789jklmnopqrstuvwxyz',
      dbPassword: 'supersecret',
      internalUrl: 'http://api.internal:8080',
    });
    const result = await pipeline.process(raw, makeCtx());
    if (result.status !== 'redacted') throw new Error('Expected redacted');
    expect(result.content.context).toEqual({});
  });

  it('context with nested objects is stripped', async () => {
    const raw = createRawLessonContent('Title', 'Content', {
      deep: { nested: { secret: 'value' } },
      array: [1, 2, 3],
    });
    const result = await pipeline.process(raw, makeCtx());
    if (result.status !== 'redacted') throw new Error('Expected redacted');
    expect(result.content.context).toEqual({});
  });

  it('context is not leaked into title', async () => {
    const raw = createRawLessonContent('Title', 'Content', {
      tenantId: 'acme-corp-2024',
    });
    const result = await pipeline.process(raw, makeCtx());
    if (result.status !== 'redacted') throw new Error('Expected redacted');
    expect(result.content.title).not.toContain('acme-corp-2024');
  });

  it('context is not leaked into content', async () => {
    const raw = createRawLessonContent('Title', 'Content', {
      secretKey: 'sk-abc123def456ghi789jklmnopqrstuvwxyz',
    });
    const result = await pipeline.process(raw, makeCtx());
    if (result.status !== 'redacted') throw new Error('Expected redacted');
    expect(result.content.content).not.toContain('sk-abc123');
  });
});

describe('Red Team: Mixed Attack Vectors', () => {
  it('kitchen sink: all PII types + secrets + paths + tenant terms', async () => {
    const r = await redact(
      'AcmeCorp Production Guide',
      `AcmeCorp agent-codex-prime-v3 (ID: 550e8400-e29b-41d4-a716-446655440000)
      
      Config:
      - API: sk-abc123def456ghi789jklmnopqrstuvwxyz  
      - DB: postgres://admin:secret@192.168.1.50:5432/acme_prod
      - Contact: ops@acmecorp.com, +1-555-123-4567
      - SSN: 123-45-6789
      - Server: http://api.acmecorp.internal:8080
      - Config: /home/deploy/.env
      - Project: Project Aurora uses InternalDB`,
    );

    const content = r.content.title + ' ' + r.content.content;
    expect(content).not.toContain('AcmeCorp');
    expect(content).not.toContain('agent-codex-prime');
    expect(content).not.toContain('550e8400');
    expect(content).not.toContain('sk-abc123');
    expect(content).not.toContain('admin:secret');
    expect(content).not.toContain('acmecorp.com');
    expect(content).not.toContain('555-123');
    expect(content).not.toContain('123-45-6789');
    expect(content).not.toContain('acmecorp.internal');
    expect(content).not.toContain('/home/deploy');
    expect(content).not.toContain('Project Aurora');
    expect(content).not.toContain('InternalDB');
    expect(r.content.context).toEqual({});
  });

  it('repeated content does not reveal patterns', async () => {
    const lessons = [
      'AcmeCorp retry pattern: always retry 3 times',
      'AcmeCorp caching pattern: use Redis with 5min TTL',
      'AcmeCorp logging: structured JSON to stdout',
    ];
    const results = await Promise.all(
      lessons.map(l => redact('Pattern', l))
    );
    for (const r of results) {
      expect(r.content.content).not.toContain('AcmeCorp');
    }
  });

  it('findings provide layer attribution but no original content', async () => {
    const r = await redact(
      'Secrets',
      'Use sk-abc123def456ghi789jklmnopqrstuvwxyz and admin@acmecorp.com'
    );
    for (const f of r.findings) {
      // Findings should have layer info but NOT contain the original secret
      expect(f.layer).toBeTruthy();
      expect(f.replacement).toBeTruthy();
      // originalLength is just a number, not the actual content
      expect(typeof f.originalLength).toBe('number');
    }
  });
});
