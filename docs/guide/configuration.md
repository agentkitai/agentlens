# Configuration

AgentLens is configured through environment variables with sensible defaults. No config files needed.

## Server Configuration

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3400` | HTTP server port |
| `CORS_ORIGIN` | `*` | CORS allowed origins (comma-separated or `*`) |
| `AUTH_DISABLED` | `false` | Disable API key authentication (dev mode only) |
| `DB_PATH` | `./agentlens.db` | SQLite database file path |
| `DATABASE_PATH` | `./agentlens.db` | Alias for `DB_PATH` |
| `RETENTION_DAYS` | `90` | Days to keep events (0 = keep forever) |

### Example

```bash
PORT=3400 \
DB_PATH=/var/data/agentlens.db \
RETENTION_DAYS=180 \
AUTH_DISABLED=false \
npx @agentlens/server
```

## MCP Server Configuration

| Variable | Default | Description |
|---|---|---|
| `AGENTLENS_API_URL` | `http://localhost:3400` | AgentLens server URL |
| `AGENTLENS_API_KEY` | — | API key for authentication |
| `AGENTLENS_AGENT_NAME` | `unnamed-agent` | Human-readable agent name |
| `AGENTLENS_AGENT_VERSION` | — | Agent version string |
| `AGENTLENS_ENVIRONMENT` | `development` | Environment tag (development/staging/production) |

### Example

```json
{
  "mcpServers": {
    "agentlens": {
      "command": "npx",
      "args": ["@agentlens/mcp"],
      "env": {
        "AGENTLENS_API_URL": "http://localhost:3400",
        "AGENTLENS_API_KEY": "als_abc123...",
        "AGENTLENS_AGENT_NAME": "my-agent",
        "AGENTLENS_AGENT_VERSION": "2.1.0",
        "AGENTLENS_ENVIRONMENT": "production"
      }
    }
  }
}
```

## SQLite Tuning

AgentLens uses SQLite with these performance-optimized pragmas (applied automatically):

| Pragma | Value | Why |
|---|---|---|
| `journal_mode` | `WAL` | Concurrent read/write support |
| `synchronous` | `NORMAL` | Good durability with better performance |
| `cache_size` | `-64000` | 64 MB page cache |
| `busy_timeout` | `5000` | 5s retry on lock contention |

These are set at database initialization and cannot be changed via environment variables.

## Integration Secrets

Webhook secrets for integration endpoints are configured via the Settings page in the dashboard or via the config API:

```bash
# Set AgentGate webhook secret
curl -X PUT http://localhost:3400/api/config \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer als_your_key" \
  -d '{"agentGateSecret": "your-hmac-secret"}'

# Set FormBridge webhook secret
curl -X PUT http://localhost:3400/api/config \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer als_your_key" \
  -d '{"formBridgeSecret": "your-hmac-secret"}'
```
