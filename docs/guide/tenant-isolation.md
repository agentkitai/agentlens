# Tenant Isolation — Security Guide

AgentLens supports multi-tenant operation where each tenant's data is fully isolated. This guide covers the isolation model, how it works, and security considerations.

## Overview

Tenant isolation ensures that:

- **Data is scoped** — Events, sessions, lessons, and embeddings belong to a specific tenant
- **API keys are tenant-bound** — Each API key is associated with exactly one tenant
- **Queries are filtered** — All data access is automatically scoped to the authenticated tenant
- **No cross-tenant leakage** — One tenant cannot access another tenant's data, even via semantic search

## How It Works

### Authentication Flow

```
Agent → API Key → Tenant ID → Scoped Data Access
```

1. Agent sends a request with an API key (`Authorization: Bearer als_...`)
2. Server resolves the API key to a tenant ID
3. All database queries include a `tenant_id` filter
4. Response contains only data belonging to that tenant

### Data Scoping

Every data entity is associated with a tenant:

| Entity | Tenant Column | Description |
|---|---|---|
| Events | `tenant_id` | All events are tenant-scoped |
| Sessions | `tenant_id` | Sessions belong to a tenant |
| Lessons | `tenant_id` | Lessons are tenant-scoped |
| Embeddings | `tenant_id` | Vector embeddings are tenant-isolated |
| API Keys | `tenant_id` | Keys are created per-tenant |

### Query Isolation

All repository methods (data access layer) enforce tenant isolation:

```sql
-- Every query includes the tenant filter
SELECT * FROM events WHERE tenant_id = ? AND session_id = ?;
SELECT * FROM lessons WHERE tenant_id = ? AND category = ?;
```

This is enforced at the repository layer, not the API layer, making it impossible to bypass via query parameter manipulation.

### Embedding Isolation

Semantic search (recall) is also tenant-isolated:

- Embeddings are stored with a `tenant_id` column
- Vector similarity searches include `WHERE tenant_id = ?`
- Cross-tenant semantic matches are impossible

## API Key Management

### Creating Tenant-Scoped Keys

```bash
curl -X POST http://localhost:3400/api/keys \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer als_admin_key" \
  -d '{
    "name": "production-agent",
    "tenantId": "tenant_acme",
    "scopes": ["events:write", "events:read", "lessons:*"]
  }'
```

### Scopes

API keys can be restricted to specific operations:

| Scope | Description |
|---|---|
| `*` | Full access |
| `events:read` | Read events and sessions |
| `events:write` | Ingest events |
| `lessons:read` | Read lessons |
| `lessons:write` | Create/update lessons |
| `lessons:*` | Full lesson access |
| `recall:read` | Semantic search |
| `reflect:read` | Pattern analysis |
| `context:read` | Context retrieval |

### Key Rotation

Rotate keys without downtime:

1. Create a new key for the same tenant
2. Update agent configuration to use the new key
3. Verify the agent works with the new key
4. Revoke the old key

```bash
# Create new key
curl -X POST http://localhost:3400/api/keys \
  -H "Authorization: Bearer als_admin_key" \
  -d '{"name": "agent-v2", "tenantId": "tenant_acme"}'

# Revoke old key
curl -X DELETE http://localhost:3400/api/keys/old_key_id \
  -H "Authorization: Bearer als_admin_key"
```

## Security Considerations

### Single-Tenant Mode

For self-hosted single-tenant deployments, set:

```bash
AUTH_DISABLED=true  # Development only
```

In production, always use API keys even for single-tenant setups to prevent unauthorized access.

### Default Tenant

When `AUTH_DISABLED=true`, all data is assigned to the `default` tenant. This is convenient for development but should never be used in production.

### Network Security

- Run AgentLens behind a reverse proxy (nginx, Caddy) with TLS
- Restrict network access to trusted agents only
- Use environment-specific API keys (dev, staging, production)

### Audit Trail

All data modifications are recorded in the tamper-evident hash chain. Even with tenant isolation, the audit trail provides:

- **Who** — Which API key (and thus which tenant/agent) performed the action
- **What** — The exact event or modification
- **When** — Cryptographically-linked timestamps
- **Integrity** — SHA-256 hash chains per session, verifiable

### Data Retention

Configure per-tenant data retention policies:

| Variable | Default | Description |
|---|---|---|
| `RETENTION_DAYS` | `90` | Days to retain events |
| `RETENTION_LESSONS` | `forever` | Lessons are kept indefinitely by default |

## Best Practices

1. **One tenant per organization** — Don't share tenants across organizations
2. **Separate keys per agent** — Each agent should have its own API key
3. **Least-privilege scopes** — Only grant the scopes each agent needs
4. **Rotate keys regularly** — Rotate API keys on a schedule (e.g., quarterly)
5. **Monitor key usage** — Check `GET /api/keys` to see last-used timestamps
6. **Use TLS** — Always encrypt traffic in production
