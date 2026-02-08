# Lessons API

Manage agent lessons — distilled insights and knowledge learned from agent experience.

## POST /api/lessons

Create a new lesson.

### Request Body

```json
{
  "title": "Always run tests before deploying",
  "content": "Running the full test suite before deployment catches 90% of regressions. Skip at your peril.",
  "category": "deployment",
  "importance": "high",
  "agentId": "my-agent",
  "context": { "trigger": "deployment failure" },
  "sourceSessionId": "ses_abc123",
  "sourceEventId": "01HXYZ..."
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `title` | string | ✅ | Lesson title |
| `content` | string | ✅ | Lesson content / body |
| `category` | string | — | Category (default: `general`) |
| `importance` | string | — | `low`, `normal`, `high`, `critical` (default: `normal`) |
| `agentId` | string | — | Agent ID to scope the lesson to |
| `context` | object | — | Additional context metadata |
| `sourceSessionId` | string | — | Session ID where this lesson originated |
| `sourceEventId` | string | — | Event ID where this lesson originated |

### Response (201)

```json
{
  "id": "lesson_abc123",
  "tenantId": "default",
  "title": "Always run tests before deploying",
  "content": "Running the full test suite before deployment catches 90% of regressions.",
  "category": "deployment",
  "importance": "high",
  "agentId": "my-agent",
  "context": { "trigger": "deployment failure" },
  "sourceSessionId": "ses_abc123",
  "accessCount": 0,
  "createdAt": "2026-02-08T10:00:00.000Z",
  "updatedAt": "2026-02-08T10:00:00.000Z"
}
```

---

## GET /api/lessons

List lessons with optional filters.

### Query Parameters

| Parameter | Type | Default | Description |
|---|---|---|---|
| `category` | string | — | Filter by category |
| `importance` | string | — | Filter by importance level |
| `agentId` | string | — | Filter by agent ID |
| `search` | string | — | Text search in title and content |
| `limit` | number | `50` | Results per page (max: 500) |
| `offset` | number | `0` | Pagination offset |
| `includeArchived` | boolean | `false` | Include archived (deleted) lessons |

### Response (200)

```json
{
  "lessons": [
    {
      "id": "lesson_abc123",
      "tenantId": "default",
      "title": "Always run tests before deploying",
      "content": "Running the full test suite...",
      "category": "deployment",
      "importance": "high",
      "agentId": "my-agent",
      "context": {},
      "accessCount": 5,
      "lastAccessedAt": "2026-02-08T12:00:00.000Z",
      "createdAt": "2026-02-01T10:00:00.000Z",
      "updatedAt": "2026-02-05T15:30:00.000Z"
    }
  ],
  "total": 42
}
```

---

## GET /api/lessons/:id

Get a single lesson by ID.

### Response (200)

Returns the full lesson object (same schema as the create response).

### Errors

| Status | Cause |
|---|---|
| 404 | Lesson not found |

---

## PUT /api/lessons/:id

Update an existing lesson.

### Request Body

All fields are optional — only include the fields you want to change.

```json
{
  "title": "Updated title",
  "content": "Updated content",
  "category": "security",
  "importance": "critical"
}
```

### Response (200)

Returns the updated lesson object.

### Errors

| Status | Cause |
|---|---|
| 404 | Lesson not found |

---

## DELETE /api/lessons/:id

Archive a lesson (soft delete).

### Response (200)

```json
{
  "id": "lesson_abc123",
  "archived": true
}
```

### Errors

| Status | Cause |
|---|---|
| 404 | Lesson not found |

---

## curl Examples

```bash
# Create a lesson
curl -X POST http://localhost:3400/api/lessons \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer als_your_key" \
  -d '{
    "title": "Always validate input",
    "content": "User inputs must be validated before processing to prevent injection attacks.",
    "category": "security",
    "importance": "high"
  }'

# List lessons filtered by category
curl "http://localhost:3400/api/lessons?category=security&importance=high" \
  -H "Authorization: Bearer als_your_key"

# Search lessons
curl "http://localhost:3400/api/lessons?search=deployment%20best%20practices" \
  -H "Authorization: Bearer als_your_key"

# Get a specific lesson
curl "http://localhost:3400/api/lessons/lesson_abc123" \
  -H "Authorization: Bearer als_your_key"

# Update a lesson
curl -X PUT http://localhost:3400/api/lessons/lesson_abc123 \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer als_your_key" \
  -d '{ "content": "Updated content with more detail." }'

# Delete a lesson
curl -X DELETE http://localhost:3400/api/lessons/lesson_abc123 \
  -H "Authorization: Bearer als_your_key"
```

## CLI Usage

```bash
agentlens lessons list
agentlens lessons list --category deployment --importance high
agentlens lessons create --title "Always run tests" --content "Run test suite before deploying" --category deployment
agentlens lessons get <id>
agentlens lessons update <id> --content "updated content"
agentlens lessons delete <id>
agentlens lessons search "deployment best practices"
```

## SDK Example

```typescript
import { AgentLensClient } from '@agentlensai/sdk';

const client = new AgentLensClient({
  url: 'http://localhost:3400',
  apiKey: 'als_your_key',
});

// Create
const lesson = await client.createLesson({
  title: 'Always run tests',
  content: 'Run the full test suite before deploying.',
  category: 'deployment',
  importance: 'high',
});

// List
const { lessons, total } = await client.getLessons({
  category: 'deployment',
  importance: 'high',
});

// Search
const results = await client.getLessons({ search: 'deployment best practices' });

// Update
await client.updateLesson(lesson.id, { content: 'Updated content' });

// Delete
await client.deleteLesson(lesson.id);
```
