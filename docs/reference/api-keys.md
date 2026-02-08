# API Keys

## POST /api/keys

Create a new API key. The raw key is returned only in this response — store it securely.

### Request Body

```json
{
  "name": "my-agent-key",
  "scopes": ["*"]
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `name` | string | — | Key name for identification (default: `"Unnamed Key"`) |
| `scopes` | string[] | — | Permission scopes (default: `["*"]`) |

### Response (201)

```json
{
  "id": "01HXYZ...",
  "key": "als_a1b2c3d4e5f6...",
  "name": "my-agent-key",
  "scopes": ["*"],
  "createdAt": "2026-02-08T10:00:00.000Z"
}
```

::: warning
The `key` field is shown only once. The server stores a SHA-256 hash — the raw key cannot be retrieved later.
:::

### curl Example

```bash
curl -X POST http://localhost:3400/api/keys \
  -H "Content-Type: application/json" \
  -d '{"name": "production-agent"}'
```

---

## GET /api/keys

List all API keys. Raw keys are never exposed.

### Response (200)

```json
{
  "keys": [
    {
      "id": "01HXYZ...",
      "name": "my-agent-key",
      "scopes": ["*"],
      "createdAt": "2026-02-08T10:00:00.000Z"
    }
  ]
}
```

---

## DELETE /api/keys/:id

Revoke (soft-delete) an API key.

### Response (200)

```json
{
  "id": "01HXYZ...",
  "deleted": true
}
```

### Errors

| Status | Cause |
|---|---|
| 404 | Key not found |
