# Privacy Controls Reference

Comprehensive guide to AgentLens v0.9.0 privacy protections for community sharing.

## Overview

AgentLens enforces a **zero-trust** approach to data sharing. No data leaves your tenant without passing through:

1. **6-layer redaction pipeline** — automated content sanitization
2. **Anonymous ID system** — rotating pseudonymous identifiers
3. **Hierarchical toggles** — granular sharing control
4. **Deny lists** — custom content blocking rules
5. **Kill switch** — instant purge of all shared data
6. **Audit trail** — complete log of all sharing operations

## Redaction Pipeline

Every lesson passes through 6 ordered layers before sharing:

| Order | Layer | What It Does |
|-------|-------|-------------|
| 1 | **Secret Detection** | Catches API keys, tokens, passwords (40+ patterns + entropy analysis) |
| 2 | **PII Detection** | Detects emails, phone numbers, SSNs, credit cards, IP addresses |
| 3 | **URL/Path Scrubbing** | Replaces internal URLs, file paths, private IPs; preserves public domains |
| 4 | **Tenant Deidentification** | Strips tenant IDs, agent IDs, org names, user IDs |
| 5 | **Semantic Deny List** | Blocks lessons matching custom deny-list patterns |
| 6 | **Human Review** | Queues for manual approval (when enabled) |

**Fail-closed behavior:** If any layer errors, the lesson is blocked entirely.

## Anonymous IDs

- Every tenant gets a **contributor ID** — a random UUID used to identify shared lessons
- IDs rotate every **24 hours** automatically
- Old IDs are preserved for audit trail
- Anonymous IDs are **not reversible** — the pool server cannot determine your tenant identity
- Different agents get different anonymous IDs

## Kill Switch

Instantly purge all your shared data from the community pool:

```bash
curl -X POST http://localhost:3000/api/community/purge \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"confirmation": "CONFIRM_PURGE"}'
```

**What happens on purge:**
1. All your shared lessons are deleted from the pool
2. Your anonymous contributor ID is retired
3. A new contributor ID is generated
4. Sharing is automatically **disabled**
5. A new purge token is generated
6. The purge is logged in the audit trail

## Audit Trail

Every sharing operation is logged:

- **Share events** — lesson ID, anonymous lesson ID, redaction findings
- **Search events** — query text, result IDs
- **Rate events** — lesson rated, voter info (anonymous)
- **Flag events** — lesson flagged for moderation
- **Purge events** — kill switch activation

**Query the audit log:**
```bash
curl "http://localhost:3000/api/community/audit?type=share&limit=50" \
  -H "Authorization: Bearer $API_KEY"
```

**Export audit data:**
```bash
curl "http://localhost:3000/api/community/audit/export?type=share" \
  -H "Authorization: Bearer $API_KEY"
```

## What Data Leaves Your Tenant

When a lesson is shared, **only these fields** are sent to the pool:

| Field | Description |
|-------|-------------|
| `anonymousContributorId` | Rotating UUID (not your tenant ID) |
| `category` | Lesson category (e.g., "error-patterns") |
| `title` | Redacted lesson title |
| `content` | Redacted lesson content (context stripped) |
| `embedding` | Numeric vector for search (not reversible to text) |

**Never sent:**
- Tenant ID, agent ID, user ID
- Context metadata
- Original (pre-redaction) content
- File paths, internal URLs
- API keys, secrets, PII
