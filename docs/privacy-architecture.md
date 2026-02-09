# Privacy Architecture — Technical Deep-Dive

## Design Principles

1. **Zero-trust pool** — the community pool server has no knowledge of tenant identities
2. **Fail-closed** — any error in the pipeline blocks sharing
3. **Defense in depth** — 6 independent redaction layers
4. **Branded types** — compile-time enforcement prevents raw content from reaching the pool
5. **Rotating anonymity** — anonymous IDs change every 24 hours

## Data Flow

```
┌─────────────────┐
│  Lesson Store    │  Raw lesson with full context
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Toggle Checks   │  Tenant → Agent → Category hierarchy
└────────┬────────┘
         │ (blocked if any toggle OFF)
         ▼
┌─────────────────┐
│ Rate Limiter    │  50/hr per tenant (configurable)
└────────┬────────┘
         │ (429 if exceeded)
         ▼
┌─────────────────────────────────────────────┐
│          6-Layer Redaction Pipeline          │
│                                             │
│  1. SecretDetectionLayer     (order: 10)    │
│  2. PIIDetectionLayer        (order: 20)    │
│  3. UrlPathScrubbingLayer    (order: 30)    │
│  4. TenantDeidentification   (order: 40)    │
│  5. SemanticDenyListLayer    (order: 50)    │
│  6. HumanReviewLayer         (order: 60)    │
│                                             │
│  RawLessonContent → RedactedLessonContent   │
└────────┬────────────────────────────────────┘
         │ (blocked/pending_review/error = stop)
         ▼
┌─────────────────┐
│ Anonymous ID    │  Rotating 24h UUID
│ Generation      │  (getOrRotateContributorId)
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Embedding       │  Hash-based 64-dim vector
│ Computation     │  (not reversible to text)
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Pool Transport  │  Send: {anonId, category, title, content, embedding}
│ (HTTP/Local)    │  Never: tenantId, agentId, context, raw content
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Audit Log       │  Record: event type, findings, lesson hash
└─────────────────┘
```

## 6-Layer Redaction Pipeline

### Layer 1: Secret Detection (order: 10)

- **40+ regex patterns** for API keys (AWS, GitHub, Stripe, etc.)
- **Shannon entropy calculator** — detects high-entropy strings (potential secrets)
- Patterns include: `AKIA[0-9A-Z]{16}`, `ghp_[A-Za-z0-9]{36}`, `sk-[A-Za-z0-9]{48}`
- Replaces matches with `[REDACTED:secret]`

### Layer 2: PII Detection (order: 20)

- Email addresses, phone numbers, SSN, credit card numbers
- IP addresses (all formats)
- Optional Presidio integration for advanced NER
- Replaces matches with `[REDACTED:pii]`

### Layer 3: URL/Path Scrubbing (order: 30)

- Internal URLs (private IPs, localhost, .local domains)
- File paths (`/home/`, `/etc/`, `C:\Users\`, etc.)
- Private IP ranges (10.x, 172.16-31.x, 192.168.x)
- **Preserves** public domain URLs (github.com, stackoverflow.com, etc.)
- Replaces with `[REDACTED:url]` or `[REDACTED:path]`

### Layer 4: Tenant Deidentification (order: 40)

- Strips tenant IDs, agent IDs, user IDs
- Removes organization names (configurable)
- Catches UUID patterns that might be internal identifiers
- Context field is always stripped entirely

### Layer 5: Semantic Deny List (order: 50)

- Matches against tenant-configured deny-list rules
- Supports plain text and regex patterns
- **Blocks the entire lesson** on match (not just redaction)

### Layer 6: Human Review (order: 60)

- When enabled, queues lessons for manual approval
- Review items have configurable expiry
- Pass-through when disabled (default)

## Branded Types

TypeScript branded types enforce compile-time safety:

```typescript
type RawLessonContent = { title: string; content: string; context: Record<string, unknown> } & { __brand: 'raw' };
type RedactedLessonContent = { title: string; content: string } & { __brand: 'redacted' };
```

- `RawLessonContent` is **not assignable** to `RedactedLessonContent`
- The pipeline is the only code path that produces `RedactedLessonContent`
- Pool transport only accepts `RedactedLessonContent`

## Zero-Trust Pool

The community pool server:
- Only stores anonymous contributor IDs (rotating UUIDs)
- Has no tenant mapping table
- Cannot reverse anonymous IDs to tenant identities
- Stores embeddings (hash-based, not reversible to text)
- Supports purge by contributor ID

## Anonymous ID Rotation

```
Time ─────────────────────────────────────────────►

Tenant A:  [uuid-1 ··· 24h ···] [uuid-2 ··· 24h ···] [uuid-3 ···
Tenant B:  [uuid-4 ··· 24h ···] [uuid-5 ··· 24h ···] [uuid-6 ···

Old IDs kept in anonymous_id_map for audit trail.
After kill-switch purge: old ID retired, new ID generated immediately.
```
