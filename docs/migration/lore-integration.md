# Lore Integration Migration Guide

AgentLens v0.12.0 removes built-in lesson management, community sharing, and redaction in favor of [Lore](https://github.com/amitpaz1/lore) — a dedicated cross-agent memory system.

## What Was Removed

| Component | Package | Replacement |
|---|---|---|
| Lesson CRUD (`POST/GET/PUT/DELETE /api/lessons`) | server | Lore API |
| Community sharing (`/api/community/*`) | server | Lore community features |
| Redaction pipeline (6-layer) | server | Lore's built-in redaction |
| `pool-server` package | pool-server | Lore server |
| `agentlens_learn` MCP tool | mcp | `lore` MCP tools |
| `agentlens_community` MCP tool | mcp | `lore` MCP tools |
| `client.createLesson()` etc. | sdk | `lore-sdk` |

## Setting Up Lore Integration

### 1. Enable the feature flag

```bash
# In your .env or environment
LORE_ENABLED=true
LORE_API_URL=http://localhost:3500   # Your Lore server
LORE_API_KEY=lore_your_key           # Optional, if Lore requires auth
```

### 2. What happens when enabled

- Dashboard shows Lessons and Community nav items (proxied to Lore)
- `GET /api/config/features` returns `{ loreEnabled: true }`
- Proxy routes forward `/api/lore/*` to your Lore server

### 3. What happens when disabled (default)

- No lesson/community UI in the dashboard
- Lesson and community API endpoints return 404
- AgentLens works as a pure observability tool

## SDK Migration

**Before (v0.11.x):**
```typescript
import { AgentLensClient } from '@agentlensai/sdk';
const client = new AgentLensClient({ baseUrl, apiKey });
await client.createLesson({ title: 'Fix', content: '...', category: 'debug' });
const lessons = await client.getLessons();
```

**After (v0.12.0):**
```typescript
// SDK lesson methods now throw "deprecated" errors
// Use lore-sdk directly:
import { LoreClient } from 'lore-sdk';
const lore = new LoreClient({ url: 'http://localhost:3500' });
await lore.createLesson({ title: 'Fix', content: '...', category: 'debug' });
```

## MCP Migration

**Before:** `agentlens_learn` and `agentlens_community` tools in `@agentlensai/mcp`

**After:** Use the Lore MCP server alongside AgentLens MCP:

```json
{
  "mcpServers": {
    "agentlens": {
      "command": "npx",
      "args": ["@agentlensai/mcp"],
      "env": { "AGENTLENS_API_URL": "http://localhost:3400" }
    },
    "lore": {
      "command": "npx",
      "args": ["@lore/mcp"],
      "env": { "LORE_API_URL": "http://localhost:3500" }
    }
  }
}
```

## Data Export

Before migrating, export existing lessons:

```bash
cd packages/server
npx tsx scripts/export-lessons.ts --output lessons-export.json
```

Then import into Lore using its CLI or API.

## Timeline

- **v0.12.0**: Lesson/community/redaction removed, Lore proxy available
- Deprecated SDK methods throw errors immediately (no grace period)
- The `pool-server` package is fully removed from the monorepo
