# Context API

Retrieve cross-session context for a topic — related session summaries and lessons ranked by relevance.

## GET /api/context

Retrieve context from past sessions relevant to a given topic. Useful for building system prompts, grounding agent decisions in past experience, or auditing topic-specific history.

### Query Parameters

| Parameter | Type | Default | Description |
|---|---|---|---|
| `topic` | string | *(required)* | Topic to retrieve context for |
| `userId` | string | — | Filter by user ID |
| `agentId` | string | — | Filter by agent ID |
| `limit` | number | `5` | Maximum number of sessions to include |

### Response (200)

```json
{
  "topic": "database migrations",
  "sessions": [
    {
      "sessionId": "ses_abc123",
      "agentId": "my-agent",
      "startedAt": "2026-02-01T10:00:00.000Z",
      "endedAt": "2026-02-01T10:30:00.000Z",
      "summary": "Performed schema migration for users table — added email_verified column",
      "relevanceScore": 0.91,
      "keyEvents": [
        {
          "id": "01HXYZ...",
          "eventType": "tool_call",
          "summary": "Called run_migration with schema v12",
          "timestamp": "2026-02-01T10:05:00.000Z"
        },
        {
          "id": "01HXYZ...",
          "eventType": "tool_response",
          "summary": "Migration completed successfully",
          "timestamp": "2026-02-01T10:05:05.000Z"
        }
      ]
    }
  ],
  "lessons": [
    {
      "id": "lesson_456",
      "title": "Always backup before migration",
      "content": "Database migrations should always be preceded by a backup step to allow rollback.",
      "category": "database",
      "importance": "high",
      "relevanceScore": 0.88
    }
  ],
  "summary": "Found 3 past sessions related to database migrations, with 1 relevant lesson.",
  "totalSessions": 3
}
```

### Response Fields

| Field | Type | Description |
|---|---|---|
| `topic` | string | The original topic queried |
| `sessions` | array | Related sessions sorted by relevance |
| `sessions[].sessionId` | string | Session identifier |
| `sessions[].agentId` | string | Agent that ran the session |
| `sessions[].startedAt` | string | Session start time (ISO 8601) |
| `sessions[].endedAt` | string | Session end time (if completed) |
| `sessions[].summary` | string | Session summary |
| `sessions[].relevanceScore` | number | Relevance to the topic (0–1) |
| `sessions[].keyEvents` | array | Notable events from the session |
| `lessons` | array | Related lessons sorted by relevance |
| `lessons[].id` | string | Lesson identifier |
| `lessons[].title` | string | Lesson title |
| `lessons[].content` | string | Lesson content |
| `lessons[].category` | string | Lesson category |
| `lessons[].importance` | string | Importance level |
| `lessons[].relevanceScore` | number | Relevance to the topic (0–1) |
| `summary` | string | Overall context summary |
| `totalSessions` | number | Total matching sessions (before limit) |

### Errors

| Status | Cause |
|---|---|
| 400 | Missing `topic` parameter |
| 401 | Invalid or missing API key |

### curl Examples

```bash
# Basic context retrieval
curl "http://localhost:3400/api/context?topic=database%20migrations" \
  -H "Authorization: Bearer als_your_key"

# Scoped to a specific user
curl "http://localhost:3400/api/context?topic=user%20authentication&userId=user123" \
  -H "Authorization: Bearer als_your_key"

# Scoped to a specific agent with limited results
curl "http://localhost:3400/api/context?topic=API%20rate%20limiting&agentId=my-agent&limit=3" \
  -H "Authorization: Bearer als_your_key"
```

### CLI Usage

```bash
agentlens context "database migrations"
agentlens context "user authentication" --user user123
agentlens context "API rate limiting" --agent my-agent --limit 3
```

### SDK Example

```typescript
import { AgentLensClient } from '@agentlensai/sdk';

const client = new AgentLensClient({
  url: 'http://localhost:3400',
  apiKey: 'als_your_key',
});

const context = await client.getContext({
  topic: 'database migrations',
  agentId: 'my-agent',
  limit: 5,
});

console.log(`Context for "${context.topic}":`);
for (const session of context.sessions) {
  console.log(`  [${(session.relevanceScore * 100).toFixed(1)}%] ${session.summary}`);
}
for (const lesson of context.lessons) {
  console.log(`  Lesson: ${lesson.title}`);
}
```
