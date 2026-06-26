# Lore Integration Architecture — AgentLens

**Author:** Winston (Architecture)  
**Date:** 2026-02-12  
**Status:** Draft

---

## Overview

Replace AgentLens's built-in lesson/memory system with an optional Lore integration. Two modes: **local** (lore-sdk in-process) and **remote** (proxy to Lore server).

## Current State — What's Being Removed

```
packages/
├── pool-server/          # ENTIRE PACKAGE — 1,103 lines src, 1,979 lines test
│   └── src/
│       ├── app.ts        # Hono server for community pool
│       ├── store.ts      # SQLite pool store
│       └── types.ts      # Pool types
│
├── server/src/
│   ├── db/
│   │   └── lesson-store.ts           # 274 lines — SQLite lesson CRUD
│   ├── services/
│   │   └── community-service.ts      # 1,132 lines — sharing, deny-list, rate limiting
│   ├── routes/
│   │   ├── lessons.ts                # 170 lines — lesson REST endpoints
│   │   ├── community.ts             # 300 lines — community REST endpoints  
│   │   └── redaction-test.ts        # test endpoint for redaction
│   ├── lib/
│   │   ├── redaction/                # 874 lines — 6-layer pipeline
│   │   │   ├── pipeline.ts
│   │   │   ├── secret-detection-layer.ts
│   │   │   ├── pii-detection-layer.ts
│   │   │   ├── url-path-scrubbing-layer.ts
│   │   │   ├── tenant-deidentification-layer.ts
│   │   │   ├── semantic-denylist-layer.ts
│   │   │   └── human-review-layer.ts
│   │   └── embeddings/              # 633 lines — ONNX/OpenAI
│   │       ├── worker.ts
│   │       ├── local.ts
│   │       ├── openai.ts
│   │       ├── math.ts
│   │       ├── summarizer.ts
│   │       └── types.ts
│   └── cloud/
│       └── (lessons table in migrations + ingestion gateway)
│
├── core/src/
│   ├── community-types.ts            # Sharing config, pool types
│   └── redaction-types.ts            # Redaction layer types
│
├── dashboard/src/
│   ├── pages/
│   │   ├── Lessons.tsx
│   │   ├── CommunityBrowser.tsx
│   │   ├── SharingControls.tsx
│   │   └── SharingActivity.tsx
│   ├── components/
│   │   ├── LessonList.tsx
│   │   └── LessonEditor.tsx
│   └── api/
│       ├── lessons.ts
│       └── community.ts
│
├── sdk/src/
│   └── client.ts                     # lesson methods (createLesson, etc.)
│
└── mcp/src/tools/
    ├── learn.ts                      # agentlens_learn MCP tool
    ├── recall.ts                     # agentlens_recall MCP tool
    └── community.ts                  # agentlens_community MCP tool
```

**Total removal:** ~4,500 lines of source + ~3,000 lines of tests across 6 packages.

## Target State

```
packages/
├── server/src/
│   ├── config.ts                     # + LORE_ENABLED, LORE_API_URL, LORE_API_KEY, LORE_LOCAL
│   ├── routes/
│   │   ├── features.ts               # NEW — GET /api/config/features
│   │   └── lore-proxy.ts             # NEW — conditional proxy routes (~80 lines)
│   └── lib/
│       └── lore-client.ts            # NEW — Lore SDK/HTTP adapter (~60 lines)
│
├── dashboard/src/
│   ├── hooks/
│   │   └── useFeatures.ts            # NEW — fetch + cache feature flags
│   ├── components/
│   │   └── Layout.tsx                # MODIFIED — conditional nav items
│   └── App.tsx                       # MODIFIED — conditional routes
│
├── sdk/src/
│   └── client.ts                     # lesson methods → @deprecated stubs
│
└── mcp/src/tools/
    └── (learn.ts, community.ts removed; recall.ts kept for event/session search)
```

**Total new code:** ~200 lines (proxy + client + feature flag + dashboard hook)

## Configuration

### Environment Variables

```bash
# Lore Integration (all optional, default: disabled)
LORE_ENABLED=true                      # Enable Lore integration
LORE_MODE=remote                       # "remote" (default) or "local"

# Remote mode
LORE_API_URL=http://localhost:8100     # Lore Phase 2 server URL
LORE_API_KEY=lore_abc123               # Lore API key

# Local mode
LORE_DB_PATH=~/.lore/agentlens.db     # SQLite path for lore-sdk
```

### Config Validation (startup)

```typescript
function validateLoreConfig(config: ServerConfig): void {
  if (!config.loreEnabled) return; // disabled = no validation needed
  
  if (config.loreMode === 'remote') {
    if (!config.loreApiUrl) throw new Error('LORE_API_URL required when LORE_ENABLED=true');
    if (!config.loreApiKey) throw new Error('LORE_API_KEY required when LORE_ENABLED=true');
  }
  // Local mode: lore-sdk handles defaults
}
```

## Server Architecture

### Feature Endpoint (no auth)

```typescript
// GET /api/config/features — public, used by dashboard
app.get('/api/config/features', (c) => {
  return c.json({
    lore: config.loreEnabled,
    // future: other feature flags
  });
});
```

### Lore Client Adapter

```typescript
// lib/lore-client.ts — abstracts local vs remote
interface LoreAdapter {
  createLesson(data: CreateInput): Promise<Lesson>;
  listLessons(query: ListQuery): Promise<{ lessons: Lesson[]; total: number }>;
  getLesson(id: string): Promise<Lesson>;
  updateLesson(id: string, data: Partial<CreateInput>): Promise<Lesson>;
  deleteLesson(id: string): Promise<void>;
  searchLessons(query: string, options?: SearchOptions): Promise<SearchResult[]>;
}

// Remote: HTTP proxy to Lore server
class RemoteLoreAdapter implements LoreAdapter {
  constructor(private apiUrl: string, private apiKey: string) {}
  // Each method: fetch(`${apiUrl}/v1/lessons/...`, { headers: { Authorization: `Bearer ${apiKey}` } })
}

// Local: lore-sdk in-process
class LocalLoreAdapter implements LoreAdapter {
  constructor(dbPath?: string) {
    this.lore = new Lore({ store: 'sqlite', dbPath });
  }
  // Each method: delegates to this.lore.publish/query/etc
}
```

### Conditional Route Registration

```typescript
// In createApp():
if (config.loreEnabled) {
  const loreAdapter = config.loreMode === 'local'
    ? new LocalLoreAdapter(config.loreDbPath)
    : new RemoteLoreAdapter(config.loreApiUrl!, config.loreApiKey!);
  
  app.use('/api/lessons/*', authMiddleware(db, config.authDisabled));
  app.route('/api/lessons', loreProxyRoutes(loreAdapter));
  app.route('/api/community', loreCommunityRoutes(loreAdapter));
}
```

## Dashboard Architecture

### Feature Detection Hook

```typescript
// hooks/useFeatures.ts
const FEATURES_URL = '/api/config/features';

export function useFeatures() {
  const [features, setFeatures] = useState<{ lore: boolean }>({ lore: false });
  
  useEffect(() => {
    fetch(FEATURES_URL)
      .then(r => r.json())
      .then(setFeatures)
      .catch(() => setFeatures({ lore: false })); // fail-closed
  }, []);
  
  return features;
}
```

### Conditional Navigation

```typescript
// Layout.tsx
const { lore } = useFeatures();

const navItems = [
  // ... always-visible items ...
  ...(lore ? [
    { to: '/lessons', label: 'Lessons', icon: BookOpen },
    { to: '/sharing', label: 'Sharing', icon: Share2 },
    { to: '/community', label: 'Community', icon: Globe },
  ] : []),
];
```

### Conditional Routes

```typescript
// App.tsx
const { lore } = useFeatures();

<Routes>
  {/* Always available */}
  <Route path="/" element={<Dashboard />} />
  <Route path="events" element={<Events />} />
  {/* ... other observability routes ... */}
  
  {/* Lore-dependent */}
  {lore && <Route path="lessons" element={<Lessons />} />}
  {lore && <Route path="sharing" element={<SharingControls />} />}
  {lore && <Route path="community" element={<CommunityBrowser />} />}
  
  {/* Catch disabled routes */}
  <Route path="*" element={<Navigate to="/" />} />
</Routes>
```

## SDK Changes

```typescript
// client.ts — lesson methods become deprecated stubs
/** @deprecated Use lore-sdk directly. See migration guide. */
async createLesson(): Promise<never> {
  throw new Error(
    'Lesson methods have been removed from AgentLens SDK. ' +
    'Use lore-sdk instead: https://github.com/amitpaz1/lore'
  );
}
```

## MCP Changes

- **Remove:** `agentlens_learn` (→ use `lore mcp` tool `save_lesson`)
- **Remove:** `agentlens_community` (→ use Lore's community features)
- **Keep:** `agentlens_recall` — this searches events/sessions (observability), not just lessons. Review if it also searches lessons and remove that path.

## Cloud Schema

- Add deprecation migration: `ALTER TABLE lessons RENAME TO lessons_deprecated;`
- Ingestion gateway: remove `'lesson'` from accepted types
- Future: DROP table after users migrate data

## Dependency Changes

### Current (all packages combined)
- `onnxruntime-node` — ONNX embeddings (server)
- `@xenova/transformers` — embeddings (pool-server)
- Various redaction-related regex deps

### After Integration
- When `LORE_ENABLED=false`: **zero new deps** — all lesson/embedding deps removed
- When `LORE_ENABLED=true` (remote): **zero new deps** — uses `fetch()` to proxy
- When `LORE_ENABLED=true` (local): `lore-sdk` as optional peer dependency

## Migration Path

### For SDK Users
```diff
- import { AgentLensClient } from '@agentkitai/agentlens-sdk';
- const client = new AgentLensClient({ apiKey: '...' });
- await client.createLesson({ title: '...', content: '...' });

+ import { Lore } from 'lore-sdk';
+ const lore = new Lore({ store: 'remote', apiUrl: '...', apiKey: '...' });
+ await lore.publish('problem', 'resolution', ['tag']);
```

### For MCP Users
```diff
# claude_desktop_config.json
- "agentlens": { "command": "agentlens-mcp", "args": ["--url", "..."] }
+ "lore": { "command": "lore", "args": ["mcp"] }
```

### For Self-Hosted
```bash
# Export existing lessons
agentlens export-lessons --format lore > lessons.json

# Import into Lore
lore import lessons.json
```

## Test Impact

**Expected test removal:** ~500-800 tests (lesson store, community service, redaction pipeline, embeddings, pool-server)

**Expected test additions:** ~30-50 tests (feature flag, proxy routes, conditional rendering, config validation)

**Net:** Test count drops, but coverage of remaining features stays 100%. The removed tests now live in the Lore repo.
