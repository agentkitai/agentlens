# API Reference

AgentLens exposes a REST API built with [Hono](https://hono.dev). The server runs on port **3400** by default.

## Base URL

```
http://localhost:3400/api
```

## Authentication

All endpoints (except `/api/health`) require an API key passed via the `Authorization` header:

```
Authorization: Bearer als_your_api_key_here
```

API keys are created via `POST /api/keys`. The raw key is shown only once — the server stores a SHA-256 hash.

When `AUTH_DISABLED=true` is set (development mode), authentication is skipped.

## Common Patterns

### Pagination

List endpoints support offset-based pagination:

| Parameter | Type | Default | Max | Description |
|---|---|---|---|---|
| `limit` | number | 50 | 500 | Results per page |
| `offset` | number | 0 | — | Number of results to skip |

Responses include:

```json
{
  "total": 1234,
  "hasMore": true
}
```

### Filtering

Most list endpoints support filtering via query parameters. Multiple values can be comma-separated:

```
GET /api/events?eventType=tool_call,tool_error&severity=error,critical
```

### Date Ranges

Time-based filters use ISO 8601 strings:

```
GET /api/events?from=2026-02-01T00:00:00Z&to=2026-02-08T23:59:59Z
```

### Error Responses

All errors follow this format:

```json
{
  "error": "Human-readable error message",
  "status": 400,
  "details": [
    { "path": "payload.toolName", "message": "Required" }
  ]
}
```

## Endpoint Overview

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/health` | Health check (no auth) |
| `POST` | `/api/events` | Ingest events (batch) |
| `GET` | `/api/events` | Query events |
| `GET` | `/api/events/:id` | Get single event |
| `GET` | `/api/sessions` | List sessions |
| `GET` | `/api/sessions/:id` | Get session detail |
| `GET` | `/api/sessions/:id/timeline` | Get session timeline with chain verification |
| `GET` | `/api/analytics` | Bucketed metrics over time |
| `GET` | `/api/analytics/costs` | Cost breakdown |
| `GET` | `/api/analytics/agents` | Per-agent metrics |
| `GET` | `/api/analytics/tools` | Tool usage statistics |
| `POST` | `/api/alerts/rules` | Create alert rule |
| `GET` | `/api/alerts/rules` | List alert rules |
| `GET` | `/api/alerts/rules/:id` | Get alert rule |
| `PUT` | `/api/alerts/rules/:id` | Update alert rule |
| `DELETE` | `/api/alerts/rules/:id` | Delete alert rule |
| `GET` | `/api/alerts/history` | List alert history |
| `POST` | `/api/events/ingest` | Webhook ingestion (AgentGate/FormBridge/generic) |
| `POST` | `/api/keys` | Create API key |
| `GET` | `/api/keys` | List API keys |
| `DELETE` | `/api/keys/:id` | Revoke API key |
| `GET` | `/api/agents` | List agents |
| `GET` | `/api/agents/:id` | Get agent detail |
| `GET` | `/api/stats` | Storage statistics |
| `GET` | `/api/recall` | Semantic search over agent memory |
| `POST` | `/api/lessons` | Create a lesson |
| `GET` | `/api/lessons` | List lessons |
| `GET` | `/api/lessons/:id` | Get single lesson |
| `PUT` | `/api/lessons/:id` | Update a lesson |
| `DELETE` | `/api/lessons/:id` | Delete (archive) a lesson |
| `GET` | `/api/reflect` | Pattern analysis (errors, costs, tools, performance) |
| `GET` | `/api/context` | Cross-session context retrieval |
| `GET` | `/api/config` | Get configuration |
| `PUT` | `/api/config` | Update configuration |

Detailed documentation for each group: [Events](/reference/events) · [Sessions](/reference/sessions) · [Analytics](/reference/analytics) · [Recall](/reference/recall) · [Lessons](/reference/lessons) · [Reflect](/reference/reflect) · [Context](/reference/context) · [Alerts](/reference/alerts) · [Integrations](/reference/integrations) · [API Keys](/reference/api-keys)
