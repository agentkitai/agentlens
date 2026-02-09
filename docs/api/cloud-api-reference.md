# AgentLens Cloud API Reference

> **Base URL:** `https://api.agentlens.ai`  
> **Version:** v1  
> **Authentication:** Bearer token (API key or JWT)

---

## Table of Contents

- [Authentication](#authentication)
- [Ingestion](#ingestion)
- [Query & Usage](#query--usage)
- [Organization Management](#organization-management)
- [Team Management](#team-management)
- [API Key Management](#api-key-management)
- [Billing](#billing)
- [Audit Log](#audit-log)
- [Onboarding](#onboarding)
- [Data Export & Import](#data-export--import)
- [Error Codes](#error-codes)
- [Rate Limits](#rate-limits)

---

## Authentication

All endpoints require authentication via one of:

| Method | Header | Format | Use Case |
|--------|--------|--------|----------|
| API Key | `Authorization` | `Bearer al_xxxx...` | SDK ingestion, programmatic access |
| JWT | `Authorization` | `Bearer eyJhbG...` | Dashboard, browser sessions |

### POST /api/auth/register

Create a new user account with email/password.

**Request:**
```json
{
  "email": "user@example.com",
  "password": "SecureP@ss123",
  "name": "Jane Doe"
}
```

**Response (201):**
```json
{
  "token": "eyJhbGciOiJIUzI1NiIs...",
  "user": {
    "id": "usr_abc123",
    "email": "user@example.com",
    "name": "Jane Doe"
  }
}
```

**Errors:** `400` invalid input, `409` email already registered, `429` rate limited

---

### POST /api/auth/login

Authenticate with email/password.

**Request:**
```json
{
  "email": "user@example.com",
  "password": "SecureP@ss123"
}
```

**Response (200):**
```json
{
  "token": "eyJhbGciOiJIUzI1NiIs...",
  "user": {
    "id": "usr_abc123",
    "email": "user@example.com",
    "name": "Jane Doe"
  }
}
```

**Errors:** `401` invalid credentials, `423` account locked (brute-force), `429` rate limited

---

### GET /api/auth/oauth/:provider

Initiate OAuth flow. Supported providers: `google`, `github`.

**Response:** `302` redirect to provider authorization URL

---

### GET /api/auth/oauth/:provider/callback

OAuth callback handler. Exchanges authorization code for JWT.

**Response (200):**
```json
{
  "token": "eyJhbGciOiJIUzI1NiIs...",
  "user": {
    "id": "usr_abc123",
    "email": "user@example.com",
    "name": "Jane Doe"
  }
}
```

---

## Ingestion

Ingestion endpoints accept events from the SDK. Requires an API key with `ingest` scope.

### POST /v1/events

Ingest a single event.

**Headers:**
```
Authorization: Bearer al_prod_xxxxxxxxxxxx
Content-Type: application/json
```

**Request:**
```json
{
  "type": "llm_call",
  "session_id": "sess_abc123",
  "timestamp": "2026-02-09T10:30:00Z",
  "data": {
    "model": "gpt-4",
    "prompt_tokens": 150,
    "completion_tokens": 80,
    "latency_ms": 1200
  }
}
```

**Response (202):**
```json
{
  "accepted": true,
  "request_id": "req_550e8400-e29b-41d4-a716-446655440000"
}
```

**Errors:** `400` validation error, `403` missing ingest scope, `429` rate limited, `503` backpressure

#### Supported Event Types

| Type | Description |
|------|-------------|
| `llm_call` | LLM API call with tokens, latency, cost |
| `tool_use` | Agent tool/function invocation |
| `agent_action` | High-level agent action |
| `error` | Error or exception |
| `session_start` | Session lifecycle start |
| `session_end` | Session lifecycle end |
| `guardrail` | Guardrail check result |
| `benchmark` | Benchmark/eval result |
| `custom` | User-defined event |
| `health_check` | System health check |
| `lesson` | Agent lesson/learning |
| `embedding` | Embedding operation |

---

### POST /v1/events/batch

Ingest up to 100 events in a single request.

**Request:**
```json
{
  "events": [
    {
      "type": "llm_call",
      "session_id": "sess_abc123",
      "data": { "model": "gpt-4", "prompt_tokens": 100 }
    },
    {
      "type": "tool_use",
      "session_id": "sess_abc123",
      "data": { "tool": "web_search", "duration_ms": 340 }
    }
  ]
}
```

**Response (202):**
```json
{
  "accepted": 2,
  "rejected": 0,
  "errors": [],
  "request_id": "req_550e8400-e29b-41d4-a716-446655440001"
}
```

**Partial failure (202):**
```json
{
  "accepted": 1,
  "rejected": 1,
  "errors": [
    { "index": 1, "error": "missing required field: session_id" }
  ],
  "request_id": "req_550e8400-e29b-41d4-a716-446655440002"
}
```

**Errors:** `400` not an array / empty / exceeds 100, `403` missing ingest scope, `429` rate limited, `503` backpressure

---

## Query & Usage

### GET /api/cloud/orgs/:orgId/usage

Get usage statistics with time-series data.

**Query Parameters:**

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `range` | string | `30d` | Time range: `7d`, `30d`, `90d` |

**Response (200):**
```json
{
  "summary": {
    "events_count": 45230,
    "quota_events": 1000000,
    "plan": "pro",
    "period_start": "2026-01-10",
    "period_end": "2026-02-09"
  },
  "timeseries": [
    { "timestamp": "2026-01-10T00:00:00.000Z", "events": 1523 },
    { "timestamp": "2026-01-11T00:00:00.000Z", "events": 1891 }
  ]
}
```

---

## Organization Management

### GET /api/cloud/orgs

List organizations the authenticated user belongs to.

**Response (200):**
```json
[
  {
    "id": "org_abc123",
    "name": "My Team",
    "plan": "pro",
    "role": "owner",
    "created_at": "2026-01-15T08:00:00Z"
  }
]
```

---

### POST /api/cloud/orgs

Create a new organization.

**Request:**
```json
{
  "name": "My New Org"
}
```

**Response (201):**
```json
{
  "id": "org_def456",
  "name": "My New Org",
  "plan": "free",
  "created_at": "2026-02-09T10:00:00Z"
}
```

**Errors:** `400` invalid name, `409` duplicate name

---

### POST /api/cloud/orgs/switch

Switch the active organization context.

**Request:**
```json
{
  "orgId": "org_abc123"
}
```

**Response (200):**
```json
{
  "token": "refresh-required",
  "orgId": "org_abc123"
}
```

**Errors:** `403` not a member

---

### POST /api/cloud/orgs/:orgId/transfer

Transfer organization ownership.

**Request:**
```json
{
  "toUserId": "usr_xyz789"
}
```

**Response (200):**
```json
{ "ok": true }
```

**Errors:** `400` target not a member, `403` not owner

---

## Team Management

### GET /api/cloud/orgs/:orgId/members

List organization members.

**Response (200):**
```json
[
  {
    "user_id": "usr_abc123",
    "email": "owner@example.com",
    "display_name": "Jane Doe",
    "role": "owner",
    "joined_at": "2026-01-15T08:00:00Z"
  },
  {
    "user_id": "usr_def456",
    "email": "dev@example.com",
    "display_name": "John Smith",
    "role": "member",
    "joined_at": "2026-01-20T14:30:00Z"
  }
]
```

---

### POST /api/cloud/orgs/:orgId/invitations

Invite a new member.

**Request:**
```json
{
  "email": "newmember@example.com",
  "role": "member"
}
```

Roles: `admin`, `member`, `viewer`

**Response (201):**
```json
{
  "id": "inv_abc123",
  "email": "newmember@example.com",
  "role": "member",
  "status": "pending",
  "invited_at": "2026-02-09T10:00:00Z"
}
```

**Errors:** `400` invalid role, `409` already a member, `422` seat limit reached

---

### GET /api/cloud/orgs/:orgId/invitations

List pending invitations.

**Response (200):**
```json
[
  {
    "id": "inv_abc123",
    "email": "newmember@example.com",
    "role": "member",
    "status": "pending",
    "invited_at": "2026-02-09T10:00:00Z"
  }
]
```

---

### DELETE /api/cloud/orgs/:orgId/invitations/:invId

Cancel a pending invitation.

**Response (200):**
```json
{ "ok": true }
```

**Errors:** `404` invitation not found

---

### PUT /api/cloud/orgs/:orgId/members/:userId/role

Change a member's role.

**Request:**
```json
{
  "role": "admin"
}
```

**Response (200):**
```json
{ "ok": true }
```

**Errors:** `400` invalid role, `403` insufficient permissions

---

### DELETE /api/cloud/orgs/:orgId/members/:userId

Remove a member from the organization.

**Response (200):**
```json
{ "ok": true }
```

**Errors:** `400` cannot remove owner, `404` member not found

---

## API Key Management

### GET /api/cloud/orgs/:orgId/api-keys

List all API keys (secrets are masked).

**Response (200):**
```json
[
  {
    "id": "key_abc123",
    "name": "Production SDK",
    "key_prefix": "al_prod_abc",
    "environment": "production",
    "scopes": ["ingest", "query"],
    "created_at": "2026-01-20T10:00:00Z",
    "last_used_at": "2026-02-09T09:45:00Z",
    "revoked_at": null
  }
]
```

---

### POST /api/cloud/orgs/:orgId/api-keys

Create a new API key. The full key is returned **only once** in the response.

**Request:**
```json
{
  "name": "Production SDK",
  "environment": "production"
}
```

Environments: `production`, `staging`, `development`, `test`

**Response (201):**
```json
{
  "record": {
    "id": "key_abc123",
    "name": "Production SDK",
    "key_prefix": "al_prod_abc",
    "environment": "production",
    "scopes": ["ingest", "query"],
    "created_at": "2026-02-09T10:00:00Z"
  },
  "plaintext_key": "al_prod_abc1234567890abcdef1234567890abcdef"
}
```

> ⚠️ **Store the `plaintext_key` securely.** It cannot be retrieved again.

**Errors:** `422` key limit reached for plan tier

### Key Limits by Tier

| Tier | Max Active Keys |
|------|----------------|
| Free | 2 |
| Pro | 10 |
| Team | 50 |
| Enterprise | 200 |

---

### DELETE /api/cloud/orgs/:orgId/api-keys/:keyId

Revoke an API key. Takes effect within 60 seconds (cache TTL).

**Response (200):**
```json
{ "ok": true }
```

**Errors:** `404` key not found

---

### GET /api/cloud/orgs/:orgId/api-keys/limit

Get current key count and limit.

**Response (200):**
```json
{
  "current": 3,
  "limit": 10,
  "plan": "pro"
}
```

---

## Billing

### GET /api/cloud/orgs/:orgId/billing

Get billing overview for the organization.

**Response (200):**
```json
{
  "plan": "pro",
  "plan_name": "Pro",
  "base_price_cents": 2900,
  "event_quota": 1000000,
  "current_usage": 45230,
  "has_payment_method": true,
  "stripe_subscription_id": "sub_abc123",
  "trial": {
    "active": false,
    "days_remaining": 0
  },
  "pending_downgrade": null,
  "payment_status": "active"
}
```

---

### GET /api/cloud/orgs/:orgId/billing/invoices

List invoice history.

**Query Parameters:**

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `limit` | number | `20` | Max results |
| `offset` | number | `0` | Pagination offset |

**Response (200):**
```json
[
  {
    "id": "inv_abc123",
    "status": "paid",
    "amount_due": 2900,
    "amount_paid": 2900,
    "period_start": 1738368000,
    "period_end": 1740960000,
    "lines": [
      { "description": "Pro plan — Feb 2026", "amount": 2900, "quantity": 1 }
    ]
  }
]
```

---

### POST /api/cloud/orgs/:orgId/billing/upgrade

Upgrade to a paid plan.

**Request:**
```json
{
  "plan": "pro"
}
```

Valid plans: `pro`, `team`, `enterprise`

**Response (200):**
```json
{
  "ok": true,
  "plan": "pro"
}
```

**Errors:** `400` invalid plan or already on plan

---

### POST /api/cloud/orgs/:orgId/billing/downgrade

Downgrade to the Free plan. Takes effect at end of billing period.

**Response (200):**
```json
{
  "ok": true,
  "scheduled": "end_of_period"
}
```

---

### POST /api/cloud/orgs/:orgId/billing/portal

Create a Stripe Billing Portal session for managing payment methods.

**Response (200):**
```json
{
  "url": "https://billing.stripe.com/p/session/cs_..."
}
```

**Errors:** `400` no payment method on file

---

## Audit Log

### GET /api/cloud/orgs/:orgId/audit-log

Query the audit log with filters.

**Query Parameters:**

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `action` | string | — | Filter by action (e.g. `api_key.created`) |
| `actor` | string | — | Filter by actor user ID |
| `from` | string | — | ISO date start |
| `to` | string | — | ISO date end |
| `limit` | number | `50` | Max results |
| `offset` | number | `0` | Pagination offset |

**Audit Actions:**

| Action | Description |
|--------|-------------|
| `org.created` | Organization created |
| `org.ownership_transferred` | Ownership transferred |
| `member.invited` | Member invitation sent |
| `member.role_changed` | Member role updated |
| `member.removed` | Member removed |
| `api_key.created` | API key created |
| `api_key.revoked` | API key revoked |
| `billing.plan_changed` | Plan upgraded or downgraded |

**Response (200):**
```json
{
  "entries": [
    {
      "id": "aud_abc123",
      "org_id": "org_abc123",
      "actor_type": "user",
      "actor_id": "usr_abc123",
      "action": "api_key.created",
      "resource_type": "api_key",
      "resource_id": "key_def456",
      "details": { "name": "Production SDK", "environment": "production" },
      "result": "success",
      "created_at": "2026-02-09T10:00:00Z"
    }
  ],
  "total": 42,
  "limit": 50,
  "offset": 0
}
```

---

### GET /api/cloud/orgs/:orgId/audit-log/export

Export audit log as JSON (downloadable).

**Query Parameters:**

| Param | Type | Description |
|-------|------|-------------|
| `from` | string | ISO date start |
| `to` | string | ISO date end |

**Response (200):** JSON array with `Content-Disposition: attachment` header.

---

## Onboarding

### GET /api/cloud/onboarding/status

Check the authenticated user's onboarding progress.

**Response (200):**
```json
{
  "has_org": true,
  "has_api_key": true,
  "has_first_event": false,
  "org_id": "org_abc123",
  "api_key_prefix": "al_prod_abc"
}
```

---

### POST /api/cloud/onboarding/verify

Poll to check if the first event has been received.

**Request:**
```json
{
  "orgId": "org_abc123"
}
```

**Response (200):**
```json
{
  "received": true,
  "event_count": 3
}
```

---

## Data Export & Import

### POST /api/cloud/orgs/:orgId/export

Export organization data as NDJSON.

**Request:**
```json
{
  "from": "2026-01-01",
  "to": "2026-02-01",
  "agentId": "agent_abc123"
}
```

All fields are optional (defaults to full export).

**Response (200):** NDJSON stream with records in dependency order:

```
{"_type":"agent","_version":1,"id":"agent_abc123","name":"My Agent",...}
{"_type":"session","_version":1,"id":"sess_abc123","agent_id":"agent_abc123",...}
{"_type":"event","_version":1,"id":"evt_abc123","session_id":"sess_abc123",...}
{"_type":"checksum","sha256":"abcdef...","counts":{"agent":1,"session":1,"event":5},"exported_at":"2026-02-09T10:00:00Z"}
```

Record types: `agent`, `session`, `event`, `health_score`, `config`, `checksum`

---

### POST /api/cloud/orgs/:orgId/import

Import NDJSON data into an organization.

**Request:** NDJSON body (same format as export).

**Response (200):**
```json
{
  "imported": { "agent": 1, "session": 5, "event": 42, "health_score": 3 },
  "skipped": 2,
  "errors": [
    { "line": 15, "error": "duplicate event ID" }
  ],
  "checksumValid": true
}
```

---

## Error Codes

All error responses follow a consistent format:

```json
{
  "error": "Human-readable error message"
}
```

| HTTP Status | Meaning |
|-------------|---------|
| `400` | Bad request — invalid input, validation error |
| `401` | Unauthorized — missing or invalid credentials |
| `403` | Forbidden — valid credentials but insufficient permissions |
| `404` | Not found |
| `409` | Conflict — duplicate resource |
| `422` | Unprocessable — business rule violation (e.g., key limit) |
| `423` | Locked — account locked (brute-force protection) |
| `429` | Too many requests — rate limit exceeded |
| `503` | Service unavailable — backpressure, retry later |

### Rate Limit Headers

When rate limited (`429`), the response includes:

```
Retry-After: 60
X-RateLimit-Limit: 5000
X-RateLimit-Remaining: 0
X-RateLimit-Reset: 1738368060
```

---

## Rate Limits

Rate limits are enforced per API key and per organization (sliding window, 1-minute intervals).

### Ingestion Rate Limits (events per minute)

| Tier | Per Key | Per Org |
|------|---------|---------|
| Free | 100 | 200 |
| Pro | 5,000 | 10,000 |
| Team | 50,000 | 100,000 |
| Enterprise | 100,000 | 500,000 |

### Monthly Event Quotas

| Tier | Monthly Events |
|------|---------------|
| Free | 10,000 |
| Pro | 1,000,000 |
| Team | 10,000,000 |
| Enterprise | 100,000,000 |

When the monthly quota is exceeded:
- **Free:** Ingestion is blocked until next month
- **Pro/Team:** Overage charges apply (see [Pricing](/docs/pricing.md))
- **Enterprise:** Custom limits, contact sales

### Dashboard API Limits

Dashboard/management endpoints are rate limited at **60 requests per minute** per authenticated user.

---

## SDK Quick Start

```typescript
import { AgentLens } from '@agentlens/sdk';

const lens = new AgentLens({
  apiKey: 'al_prod_xxxxxxxxxxxx',
  cloud: true,  // Use cloud ingestion endpoint
});

// Events are automatically batched and sent
await lens.track('llm_call', {
  session_id: 'sess_abc123',
  model: 'gpt-4',
  prompt_tokens: 150,
  completion_tokens: 80,
});
```

See the [SDK Migration Guide](/docs/guide/sdk-migration.md) for migrating from self-hosted to cloud.
