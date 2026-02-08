# Security

## Authentication

### API Keys

All API requests (except health check) require authentication via API keys:

```
Authorization: Bearer als_<64-hex-chars>
```

- Keys are generated via `POST /api/keys`
- The raw key is shown **only once** at creation time
- Server stores only the **SHA-256 hash** of each key
- Authentication is a constant-time hash comparison

### Development Mode

Set `AUTH_DISABLED=true` to skip authentication during development. **Never use this in production.**

## Webhook Verification

Inbound webhooks from AgentGate and FormBridge are verified using **HMAC-SHA256**:

1. Sender computes `HMAC-SHA256(raw_body, shared_secret)` as hex
2. Signature sent in `X-Webhook-Signature` header
3. AgentLens verifies using **timing-safe comparison** (prevents timing attacks)

## Tamper Evidence

### Hash Chain

Every event includes a SHA-256 hash that chains to the previous event in its session:

```
hash = SHA-256(canonical_json(id, timestamp, sessionId, agentId, 
               eventType, severity, payload, metadata, prevHash))
```

If any event is modified after ingestion, `verifyChain()` will detect the break.

### Append-Only Storage

The events table has no UPDATE or DELETE operations (except retention cleanup). This ensures the audit trail is immutable.

## Data Protection

### Payload Truncation

Payloads exceeding 10 KB are automatically truncated. This prevents:
- Storage exhaustion from large payloads
- Query performance degradation
- Potential denial-of-service via oversized events

### CORS

Configurable via `CORS_ORIGIN` environment variable:
- Default: `*` (development)
- Production: set to your dashboard domain

### Network Isolation

AgentLens makes **no outbound network calls** except:
- Alert webhook notifications (to configured URLs)
- The MCP server's HTTP calls to the API server

No telemetry, no phone-home, no external dependencies at runtime.

## Recommendations for Production

1. Set `AUTH_DISABLED=false` (the default)
2. Generate unique API keys per agent
3. Set `CORS_ORIGIN` to your specific domain
4. Use HMAC secrets for all webhook integrations
5. Run behind a reverse proxy (nginx/caddy) with TLS
6. Set `RETENTION_DAYS` according to your compliance requirements
7. Back up the SQLite database file regularly
