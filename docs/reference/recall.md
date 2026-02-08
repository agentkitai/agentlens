# Recall API

Semantic search over agent memory — find past events, sessions, and lessons by meaning.

## GET /api/recall

Perform a semantic search using natural language queries. Results are ranked by cosine similarity against stored embeddings.

### Query Parameters

| Parameter | Type | Default | Description |
|---|---|---|---|
| `query` | string | *(required)* | Natural language search query |
| `scope` | string | `all` | Search scope: `all`, `events`, `sessions`, `lessons` |
| `agentId` | string | — | Filter by agent ID |
| `from` | string | — | Start of time range (ISO 8601) |
| `to` | string | — | End of time range (ISO 8601) |
| `limit` | number | `10` | Maximum results to return (max: 100) |
| `minScore` | number | `0` | Minimum cosine similarity score (0–1) |

### Response (200)

```json
{
  "results": [
    {
      "sourceType": "event",
      "sourceId": "01HXYZ...",
      "score": 0.92,
      "text": "Tool call: search_database with query 'user authentication'",
      "metadata": {
        "sessionId": "ses_abc123",
        "eventType": "tool_call",
        "agentId": "my-agent"
      }
    },
    {
      "sourceType": "lesson",
      "sourceId": "lesson_456",
      "score": 0.87,
      "text": "Always validate JWT tokens before processing requests",
      "metadata": {
        "category": "security",
        "importance": "high"
      }
    }
  ],
  "query": "authentication errors",
  "totalResults": 2
}
```

### Response Fields

| Field | Type | Description |
|---|---|---|
| `results` | array | Matching results, sorted by score descending |
| `results[].sourceType` | string | Type of source: `event`, `session`, or `lesson` |
| `results[].sourceId` | string | ID of the source record |
| `results[].score` | number | Cosine similarity score (0–1) |
| `results[].text` | string | Text content of the match |
| `results[].metadata` | object | Additional metadata about the source |
| `query` | string | The original query string |
| `totalResults` | number | Total results found (before limit) |

### Errors

| Status | Cause |
|---|---|
| 400 | Missing `query` parameter |
| 401 | Invalid or missing API key |
| 500 | Embedding backend error |

### curl Examples

```bash
# Basic search
curl "http://localhost:3400/api/recall?query=authentication%20errors" \
  -H "Authorization: Bearer als_your_key"

# Scoped search with date range
curl "http://localhost:3400/api/recall?query=deployment%20failures&scope=events&limit=20&from=2026-01-01T00:00:00Z&to=2026-02-01T00:00:00Z" \
  -H "Authorization: Bearer als_your_key"

# High-confidence matches only
curl "http://localhost:3400/api/recall?query=rate%20limiting&minScore=0.8" \
  -H "Authorization: Bearer als_your_key"
```

### CLI Usage

```bash
agentlens recall "authentication errors"
agentlens recall "deployment failures" --scope events --limit 20
agentlens recall "user onboarding" --from 2026-01-01 --to 2026-02-01
agentlens recall "auth" --json
```

### SDK Example

```typescript
import { AgentLensClient } from '@agentlensai/sdk';

const client = new AgentLensClient({
  url: 'http://localhost:3400',
  apiKey: 'als_your_key',
});

const result = await client.recall({
  query: 'authentication errors',
  scope: 'events',
  limit: 10,
  minScore: 0.5,
});

for (const r of result.results) {
  console.log(`[${r.sourceType}] ${(r.score * 100).toFixed(1)}% — ${r.text}`);
}
```
