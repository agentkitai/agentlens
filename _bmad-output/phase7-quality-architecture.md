# AgentLens Quality & Hardening — Technical Architecture

## Phase 7: Security, Performance, Code Quality & Documentation

**Date:** 2026-02-10
**Author:** Winston (Software Architect, BMAD Pipeline)
**Source:** Phase 7 PRD (John, 2026-02-10)
**Status:** Draft
**Version:** 0.1

---

## Table of Contents

1. [Overview](#1-overview)
2. [Security Hardening](#2-security-hardening)
3. [Performance Optimizations](#3-performance-optimizations)
4. [Code Quality Improvements](#4-code-quality-improvements)
5. [Documentation Architecture](#5-documentation-architecture)
6. [Migration & Compatibility](#6-migration--compatibility)
7. [Testing Strategy](#7-testing-strategy)

---

## 1. Overview

Phase 7 is a purely internal quality phase — no new tables, no new APIs (except one aggregation endpoint), no new user-facing features. All changes target existing files with surgical edits. The architecture is about **how to make these changes safely** with zero regressions.

### 1.1 Change Impact Summary

| Category | Files Modified | Files Created | Files Deleted |
|----------|---------------|---------------|---------------|
| Security | 8 | 2 | 0 |
| Performance | 11 | 3 | 0 |
| Code Quality | ~30 | ~20 | 1 (client.ts → split) |
| Documentation | 5 modified | 5 new | 0 |
| **Total** | **~54** | **~30** | **1** |

### 1.2 Architectural Principles

- **No new runtime dependencies.** Logger, error utility, and rate limiter improvements are zero-dependency implementations.
- **Backward compatibility first.** Every change is configurable via env vars. Existing deployments with explicit config don't break.
- **Facade pattern for decomposition.** Large class splits use a facade that delegates to new classes, preserving the original interface.
- **Test before refactor.** Dashboard tests (cq-004) are written BEFORE the SqliteEventStore decomposition (cq-005).

---

## 2. Security Hardening

### 2.1 Pool Server Authentication (sec-001)

**Current state:** `packages/pool-server/src/app.ts` mounts 18 routes with zero authentication middleware.

**Design:**

```typescript
// packages/pool-server/src/auth.ts (NEW)

export type AuthScope = 'admin' | 'agent' | 'contributor' | 'public';

interface AuthConfig {
  apiKey?: string;        // POOL_API_KEY env var
  adminKey?: string;      // POOL_ADMIN_KEY env var (optional, falls back to apiKey)
}

export function createAuthMiddleware(config: AuthConfig) {
  return function authMiddleware(requiredScope: AuthScope) {
    return (c: Context, next: Next) => {
      if (requiredScope === 'public') return next();
      
      const authHeader = c.req.header('Authorization');
      if (!authHeader?.startsWith('Bearer ')) {
        return c.json({ error: 'Authentication required' }, 401);
      }
      
      const token = authHeader.slice(7);
      const expectedKey = requiredScope === 'admin' 
        ? (config.adminKey || config.apiKey) 
        : config.apiKey;
      
      if (!expectedKey || token !== expectedKey) {
        return c.json({ error: 'Invalid credentials' }, 401);
      }
      
      return next();
    };
  };
}
```

**Route scope assignments:**

| Scope | Endpoints |
|-------|-----------|
| `admin` | `/pool/moderation/*`, `/pool/purge`, `/pool/purge-token` |
| `agent` | `/pool/register`, `/pool/unregister`, `/pool/delegate` |
| `contributor` | `/pool/share`, `/pool/reputation/*` |
| `public` | `/pool/search`, `/pool/lessons`, `/pool/health` |

**app.ts modification:**

```typescript
// packages/pool-server/src/app.ts

import { createAuthMiddleware } from './auth.js';

const auth = createAuthMiddleware({
  apiKey: process.env.POOL_API_KEY,
  adminKey: process.env.POOL_ADMIN_KEY,
});

// Before (no auth):
// app.post('/pool/moderation/approve/:id', async (c) => { ... });

// After:
app.post('/pool/moderation/approve/:id', auth('admin'), async (c) => { ... });
app.post('/pool/register', auth('agent'), async (c) => { ... });
app.post('/pool/share', auth('contributor'), async (c) => { ... });
app.get('/pool/search', async (c) => { ... }); // public, rate-limited
```

**Affected files:**
- `packages/pool-server/src/app.ts` — add auth middleware to all routes
- `packages/pool-server/src/auth.ts` — NEW: auth middleware
- `packages/pool-server/src/index.ts` — load POOL_API_KEY from env

### 2.2 Secure Default Configuration (sec-002)

**Changes to `packages/server/src/config.ts`:**

```typescript
// Before:
corsOrigin: process.env.CORS_ORIGIN || '*',

// After:
corsOrigin: process.env.CORS_ORIGIN || 'http://localhost:3400',
```

**Changes to `packages/server/src/index.ts` (startup):**

```typescript
if (config.authDisabled) {
  console.warn('⚠️  Authentication is disabled. Enable auth for non-development deployments.');
}

if (!config.authDisabled && config.corsOrigin === '*') {
  console.error('❌ CORS_ORIGIN=* is not allowed when authentication is enabled. Set a specific origin.');
  process.exit(1);
}
```

**Changes to `.env.example`:**

```env
# Authentication — set to true ONLY for local development
AUTH_DISABLED=false

# CORS — set to your dashboard URL in production
CORS_ORIGIN=http://localhost:3400

# Server port
PORT=3400
```

**Affected files:**
- `packages/server/src/config.ts`
- `packages/server/src/index.ts`
- `.env`
- `.env.example`

### 2.3 Bounded Rate Limiter (sec-003)

**Changes to `packages/pool-server/src/rate-limiter.ts`:**

```typescript
export class RateLimiter {
  private entries = new Map<string, { count: number; resetAt: number }>();
  private readonly maxEntries: number;
  private cleanupInterval: NodeJS.Timeout;

  constructor(
    private windowMs: number,
    private maxRequests: number,
    maxEntries = 100_000,
  ) {
    this.maxEntries = maxEntries;
    // Periodic cleanup every 60 seconds
    this.cleanupInterval = setInterval(() => this.cleanup(), 60_000);
  }

  check(key: string): boolean {
    const now = Date.now();
    const entry = this.entries.get(key);
    
    if (entry && entry.resetAt > now) {
      entry.count++;
      return entry.count <= this.maxRequests;
    }
    
    // Evict if at capacity
    if (this.entries.size >= this.maxEntries) {
      this.evictOldest();
    }
    
    this.entries.set(key, { count: 1, resetAt: now + this.windowMs });
    return true;
  }

  private cleanup(): void {
    const now = Date.now();
    let removed = 0;
    for (const [key, entry] of this.entries) {
      if (entry.resetAt <= now) {
        this.entries.delete(key);
        removed++;
      }
    }
    if (this.entries.size > 50_000) {
      console.warn(`Rate limiter map size: ${this.entries.size}, approaching limit`);
    }
  }

  private evictOldest(): void {
    // Delete first 10% of entries (oldest by insertion order, Map preserves insertion order)
    const toEvict = Math.max(1, Math.floor(this.entries.size * 0.1));
    let evicted = 0;
    for (const key of this.entries.keys()) {
      if (evicted >= toEvict) break;
      this.entries.delete(key);
      evicted++;
    }
  }

  destroy(): void {
    clearInterval(this.cleanupInterval);
  }
}
```

### 2.4 Error Message Sanitization (sec-004)

**New file: `packages/server/src/lib/error-sanitizer.ts`**

```typescript
/**
 * Sanitizes error messages for client-facing responses.
 * Internal details (SQL errors, file paths, stack traces) are stripped.
 */
export function sanitizeErrorMessage(err: unknown, statusCode: number): string {
  // 4xx errors: allow explicit client-facing messages
  if (statusCode >= 400 && statusCode < 500) {
    if (err instanceof ClientError) return err.message;
    return 'Bad request';
  }
  
  // 5xx errors: always generic
  return 'Internal server error';
}

export class ClientError extends Error {
  constructor(message: string, public statusCode: number = 400) {
    super(message);
    this.name = 'ClientError';
  }
}
```

**Global error handler change in `packages/server/src/index.ts`:**

```typescript
// Before:
app.onError((err, c) => {
  const status = err instanceof HTTPException ? err.status : 500;
  return c.json({ error: err.message || 'Internal server error', status });
});

// After:
app.onError((err, c) => {
  const status = err instanceof HTTPException ? err.status : 500;
  log.error('Request error', { path: c.req.path, status, error: err.message, stack: err.stack });
  return c.json({ error: sanitizeErrorMessage(err, status) }, status);
});
```

**Route handler changes** (example for `events.ts`):

```typescript
// Before:
} catch (err) {
  return c.json({ error: err.message }, 500);
}

// After:
} catch (err: unknown) {
  log.error('Event query failed', { error: getErrorMessage(err) });
  return c.json({ error: 'Internal server error' }, 500);
}
```

**Affected files:**
- `packages/server/src/lib/error-sanitizer.ts` — NEW
- `packages/server/src/index.ts` — global handler
- `packages/server/src/routes/events.ts` — catch blocks
- `packages/server/src/routes/community.ts` — catch blocks

### 2.5 OTLP Route Authentication (sec-005)

**Changes to `packages/server/src/routes/otlp.ts`:**

```typescript
// Add at the top of the route registration
const otlpAuthToken = process.env.OTLP_AUTH_TOKEN;

function otlpAuth(c: Context, next: Next) {
  if (!otlpAuthToken) return next(); // No token configured = open (backward compat)
  
  const auth = c.req.header('Authorization');
  if (auth !== `Bearer ${otlpAuthToken}`) {
    return c.json({ error: 'Unauthorized' }, 401);
  }
  return next();
}

// Apply to all OTLP routes
app.post('/v1/traces', otlpAuth, rateLimitByIp(1000), sizeLimit('10mb'), async (c) => { ... });
app.post('/v1/metrics', otlpAuth, rateLimitByIp(1000), sizeLimit('10mb'), async (c) => { ... });
app.post('/v1/logs', otlpAuth, rateLimitByIp(1000), sizeLimit('10mb'), async (c) => { ... });
```

**Affected files:**
- `packages/server/src/routes/otlp.ts`
- `packages/server/src/index.ts` — mount with middleware

---

## 3. Performance Optimizations

### 3.1 Batch Guardrail Queries (perf-001)

**New method on `IEventStore` / `SqliteEventStore`:**

```typescript
// packages/server/src/db/sqlite-store.ts

interface BatchCountResult {
  total: number;
  errors: number;
  critical: number;
  toolErrors: number;
}

async countEventsBatch(
  agentId: string,
  startTime: string,
  endTime: string,
  tenantId?: string,
): Promise<BatchCountResult> {
  const sql = `
    SELECT 
      COUNT(*) as total,
      COUNT(CASE WHEN severity = 'error' THEN 1 END) as errors,
      COUNT(CASE WHEN severity = 'critical' THEN 1 END) as critical,
      COUNT(CASE WHEN event_type = 'tool_error' THEN 1 END) as toolErrors
    FROM events 
    WHERE agent_id = ? AND timestamp BETWEEN ? AND ?
    ${tenantId ? 'AND tenant_id = ?' : ''}
  `;
  const params = tenantId 
    ? [agentId, startTime, endTime, tenantId] 
    : [agentId, startTime, endTime];
  return this.db.get(sql, params);
}

async sumSessionCost(
  agentId: string, 
  startTime: string, 
  endTime: string,
  tenantId?: string,
): Promise<number> {
  const sql = `
    SELECT COALESCE(SUM(total_cost_usd), 0) as total
    FROM sessions 
    WHERE agent_id = ? AND created_at BETWEEN ? AND ?
    ${tenantId ? 'AND tenant_id = ?' : ''}
  `;
  const params = tenantId 
    ? [agentId, startTime, endTime, tenantId] 
    : [agentId, startTime, endTime];
  const result = this.db.get(sql, params);
  return result.total;
}
```

**Changes to `packages/server/src/lib/guardrails/conditions.ts`:**

```typescript
// Before (4 queries):
async function evaluateErrorRateThreshold(store, agentId, windowMs) {
  const total = await store.countEvents({ agentId, since: cutoff });
  const errors = await store.countEvents({ agentId, since: cutoff, severity: 'error' });
  const critical = await store.countEvents({ agentId, since: cutoff, severity: 'critical' });
  const toolErrors = await store.countEvents({ agentId, since: cutoff, type: 'tool_error' });
  // ...
}

// After (1 query):
async function evaluateErrorRateThreshold(store, agentId, windowMs) {
  const counts = await store.countEventsBatch(agentId, startTime, endTime);
  const errorRate = (counts.errors + counts.critical) / counts.total;
  // ...
}
```

**Fix for evaluateCustomMetric:**

```typescript
// Before:
const events = await store.queryEvents({ agentId, limit: 10000, ... });
const value = events[0]?.data?.metricValue;

// After:
const events = await store.queryEvents({ agentId, limit: 1, sort: 'desc', ... });
const value = events[0]?.data?.metricValue;
```

**Affected files:**
- `packages/server/src/db/sqlite-store.ts` — add batch methods
- `packages/server/src/lib/guardrails/conditions.ts` — use batch methods

### 3.2 Pool Server Secondary Indexes (perf-002)

**Changes to `packages/pool-server/src/store.ts`:**

```typescript
export class InMemoryPoolStore {
  private lessons = new Map<string, Lesson>();
  
  // NEW: Secondary indexes
  private lessonsByContributor = new Map<string, Set<string>>();
  private lessonsByCategory = new Map<string, Set<string>>();
  private maxLessons: number;
  private accessOrder: string[] = []; // LRU tracking

  constructor(options?: { maxLessons?: number }) {
    this.maxLessons = options?.maxLessons ?? 100_000;
  }

  async shareLessons(lessons: Lesson[]): Promise<void> {
    for (const lesson of lessons) {
      // Evict if at capacity
      if (this.lessons.size >= this.maxLessons) {
        this.evictLRU();
      }
      
      this.lessons.set(lesson.id, lesson);
      
      // Update secondary indexes
      this.addToIndex(this.lessonsByContributor, lesson.contributorId, lesson.id);
      if (lesson.category) {
        this.addToIndex(this.lessonsByCategory, lesson.category, lesson.id);
      }
      this.accessOrder.push(lesson.id);
    }
  }

  async searchLessons(query: SearchQuery): Promise<Lesson[]> {
    // Pre-filter by category if specified (O(1) lookup instead of O(n) scan)
    let candidateIds: Set<string> | null = null;
    
    if (query.category) {
      candidateIds = this.lessonsByCategory.get(query.category) ?? new Set();
    }
    
    // Build candidate list
    const candidates = candidateIds 
      ? [...candidateIds].map(id => this.lessons.get(id)!).filter(Boolean)
      : [...this.lessons.values()];
    
    // Apply reputation filter BEFORE similarity
    const filtered = candidates.filter(l => 
      !query.minReputation || l.reputation >= query.minReputation
    );
    
    // NOW compute cosine similarity on the reduced set
    const scored = filtered.map(l => ({
      lesson: l,
      score: cosineSimilarity(query.embedding, l.embedding),
    }));
    
    return scored
      .sort((a, b) => b.score - a.score)
      .slice(0, query.limit ?? 10)
      .map(s => s.lesson);
  }

  async countLessonsByContributor(contributorId: string): Promise<number> {
    return this.lessonsByContributor.get(contributorId)?.size ?? 0;
  }

  async deleteLessonsByContributor(contributorId: string): Promise<number> {
    const ids = this.lessonsByContributor.get(contributorId);
    if (!ids) return 0;
    const count = ids.size;
    for (const id of ids) {
      const lesson = this.lessons.get(id);
      if (lesson?.category) {
        this.lessonsByCategory.get(lesson.category)?.delete(id);
      }
      this.lessons.delete(id);
    }
    this.lessonsByContributor.delete(contributorId);
    return count;
  }

  private addToIndex(index: Map<string, Set<string>>, key: string, id: string): void {
    let set = index.get(key);
    if (!set) { set = new Set(); index.set(key, set); }
    set.add(id);
  }

  private evictLRU(): void {
    // Remove oldest entries until we're at 90% capacity
    const target = Math.floor(this.maxLessons * 0.9);
    while (this.lessons.size > target && this.accessOrder.length > 0) {
      const oldestId = this.accessOrder.shift()!;
      const lesson = this.lessons.get(oldestId);
      if (lesson) {
        this.lessonsByContributor.get(lesson.contributorId)?.delete(oldestId);
        if (lesson.category) {
          this.lessonsByCategory.get(lesson.category)?.delete(oldestId);
        }
        this.lessons.delete(oldestId);
      }
    }
  }
}
```

### 3.3 Alert Engine Analytics Cache (perf-003)

**Changes to `packages/server/src/lib/alert-engine.ts`:**

```typescript
async evaluate(): Promise<void> {
  const rules = await this.store.listAlertRules();
  const enabledRules = rules.filter(r => r.enabled);
  
  // Group rules by analytics key to deduplicate queries
  const groups = new Map<string, AlertRule[]>();
  for (const rule of enabledRules) {
    const key = `${rule.tenantId ?? ''}:${rule.agentId}:${rule.windowMinutes}`;
    const group = groups.get(key) ?? [];
    group.push(rule);
    groups.set(key, group);
  }
  
  // Compute analytics once per unique key
  const analyticsCache = new Map<string, AnalyticsResult>();
  for (const [key, groupRules] of groups) {
    const sample = groupRules[0];
    const analytics = await this.tenantStore.getAnalytics({
      agentId: sample.agentId,
      windowMinutes: sample.windowMinutes,
      tenantId: sample.tenantId,
    });
    analyticsCache.set(key, analytics);
  }
  
  // Evaluate all rules using cached analytics
  for (const rule of enabledRules) {
    const key = `${rule.tenantId ?? ''}:${rule.agentId}:${rule.windowMinutes}`;
    const analytics = analyticsCache.get(key)!;
    await this.evaluateRule(rule, analytics);
  }
}
```

Also: make check interval configurable:

```typescript
const CHECK_INTERVAL = parseInt(process.env.ALERT_CHECK_INTERVAL_MS ?? '60000', 10);
```

### 3.4 Dashboard Overview API Consolidation (perf-004)

**New endpoint: `packages/server/src/routes/stats.ts`**

```typescript
// GET /api/stats/overview
// Returns all overview metrics in a single response
app.get('/api/stats/overview', async (c) => {
  const now = new Date();
  const todayStart = startOfDay(now).toISOString();
  const yesterdayStart = startOfDay(subDays(now, 1)).toISOString();
  
  const [
    eventsToday, eventsYesterday,
    errorsToday, errorsYesterday,
    sessionsToday, sessionsYesterday,
    recentSessions, recentErrors,
  ] = await Promise.all([
    store.countEvents({ since: todayStart }),
    store.countEvents({ since: yesterdayStart, until: todayStart }),
    store.countEvents({ since: todayStart, severity: 'error' }),
    store.countEvents({ since: yesterdayStart, until: todayStart, severity: 'error' }),
    store.countSessions({ since: todayStart }),
    store.countSessions({ since: yesterdayStart, until: todayStart }),
    store.querySessions({ limit: 10, sort: 'desc' }),
    store.queryEvents({ severity: 'error', limit: 10, sort: 'desc' }),
  ]);
  
  return c.json({
    events: { today: eventsToday, yesterday: eventsYesterday },
    errors: { today: errorsToday, yesterday: errorsYesterday },
    sessions: { today: sessionsToday, yesterday: sessionsYesterday },
    recentSessions,
    recentErrors,
  });
});
```

**Dashboard Overview.tsx changes:**

```typescript
// Before: 10+ separate useApi calls
const events = useApi(() => getEvents({ since: todayStart, limit: 5000 }));
const sessions = useApi(() => getSessions({ since: todayStart, limit: 1000 }));
// ... 8 more calls

// After: 1 aggregated call + 1 analytics call
const overview = useApi(() => getOverviewStats());
const chartData = useApi(() => getAnalytics({ period: '24h', granularity: 'hour' }));
```

**SSE debouncing:**

```typescript
// packages/dashboard/src/hooks/useSSE.ts
// Add debounce option
const debouncedRefetch = useMemo(
  () => debounce(() => refetch(), 2500),
  [refetch]
);
```

**Affected files:**
- `packages/server/src/routes/stats.ts` — new aggregated endpoint
- `packages/dashboard/src/pages/Overview.tsx` — use new endpoint
- `packages/dashboard/src/api/client.ts` (or `stats.ts` after split) — add `getOverviewStats()`
- `packages/dashboard/src/hooks/useSSE.ts` — add debounce

### 3.5 Dashboard Code Splitting (perf-005)

**Changes to `packages/dashboard/src/App.tsx`:**

```typescript
import { lazy, Suspense } from 'react';
import { PageSkeleton } from './components/PageSkeleton';

// Before:
import Overview from './pages/Overview';
import Analytics from './pages/Analytics';
import LlmAnalytics from './pages/LlmAnalytics';
// ... 27 more imports

// After:
const Overview = lazy(() => import('./pages/Overview'));
const Analytics = lazy(() => import('./pages/Analytics'));
const LlmAnalytics = lazy(() => import('./pages/LlmAnalytics'));
// ... all pages lazy-loaded

function App() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Routes>
        <Route path="/" element={<Overview />} />
        {/* ... */}
      </Routes>
    </Suspense>
  );
}
```

**New file: `packages/dashboard/src/components/PageSkeleton.tsx`**

```typescript
export function PageSkeleton() {
  return (
    <div className="animate-pulse p-6 space-y-4">
      <div className="h-8 bg-gray-200 rounded w-1/4" />
      <div className="h-64 bg-gray-200 rounded" />
      <div className="grid grid-cols-3 gap-4">
        <div className="h-32 bg-gray-200 rounded" />
        <div className="h-32 bg-gray-200 rounded" />
        <div className="h-32 bg-gray-200 rounded" />
      </div>
    </div>
  );
}
```

**Changes to `packages/dashboard/vite.config.ts`:**

```typescript
export default defineConfig({
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          recharts: ['recharts'],
          vendor: ['react', 'react-dom', 'react-router-dom'],
        },
      },
    },
  },
});
```

---

## 4. Code Quality Improvements

### 4.1 API Client Decomposition (cq-001)

**Target structure:**

```
packages/dashboard/src/api/
├── index.ts          # Barrel re-export (backward compat)
├── core.ts           # request(), ApiError, toQueryString
├── events.ts         # getEvents, getEvent, countEvents, ...
├── sessions.ts       # getSessions, getSession, ...
├── agents.ts         # getAgents, getAgent, ...
├── analytics.ts      # getAnalytics, getCostAnalytics, ...
├── alerts.ts         # getAlertRules, createAlertRule, ...
├── guardrails.ts     # getGuardrailRules, ...
├── community.ts      # communitySearch, ...
├── benchmarks.ts     # getBenchmarks, ...
├── capabilities.ts   # getCapabilities, ...
├── delegations.ts    # getDelegations, ...
├── lessons.ts        # getLessons, ...
├── health.ts         # getHealthScores, ...
├── config.ts         # getConfig, updateConfig, ...
└── stats.ts          # getOverviewStats (new from perf-004)
```

**core.ts contains:**

```typescript
// packages/dashboard/src/api/core.ts

export class ApiError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

export async function request<T>(path: string, init?: RequestInit): Promise<T> {
  // ... existing request implementation from client.ts
}

export function toQueryString(params: Record<string, unknown>): string {
  // ... existing implementation
}

export function getBaseUrl(): string {
  // ... existing implementation
}
```

**Barrel re-export for backward compatibility:**

```typescript
// packages/dashboard/src/api/index.ts
export * from './core';
export * from './events';
export * from './sessions';
export * from './agents';
export * from './analytics';
export * from './alerts';
export * from './guardrails';
export * from './community';
export * from './benchmarks';
export * from './capabilities';
export * from './delegations';
export * from './lessons';
export * from './health';
export * from './config';
export * from './stats';
```

**Migration strategy:**
1. Create all domain modules, moving functions from `client.ts`
2. Create `index.ts` barrel that re-exports everything
3. Update all imports from `./api/client` to `./api` (or `./api/index`)
4. Verify no import breaks (grep for all import paths)
5. Delete `client.ts`

### 4.2 Structured Logger (cq-002)

**New file: `packages/server/src/lib/logger.ts`**

```typescript
type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVELS: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };

const currentLevel: LogLevel = (process.env.LOG_LEVEL as LogLevel) || 'info';

export interface Logger {
  debug(msg: string, data?: Record<string, unknown>): void;
  info(msg: string, data?: Record<string, unknown>): void;
  warn(msg: string, data?: Record<string, unknown>): void;
  error(msg: string, data?: Record<string, unknown>): void;
}

export function createLogger(namespace: string): Logger {
  function log(level: LogLevel, msg: string, data?: Record<string, unknown>) {
    if (LEVELS[level] < LEVELS[currentLevel]) return;
    
    const entry = {
      ts: new Date().toISOString(),
      level,
      ns: namespace,
      msg,
      ...data,
    };
    
    const output = JSON.stringify(entry);
    
    if (level === 'error') {
      console.error(output);
    } else if (level === 'warn') {
      console.warn(output);
    } else {
      console.log(output);
    }
  }

  return {
    debug: (msg, data) => log('debug', msg, data),
    info: (msg, data) => log('info', msg, data),
    warn: (msg, data) => log('warn', msg, data),
    error: (msg, data) => log('error', msg, data),
  };
}
```

**Migration pattern (applied to all 10+ files):**

```typescript
// Before (packages/server/src/lib/alert-engine.ts):
console.log('[AlertEngine] Starting evaluation loop');
console.error('[AlertEngine] Evaluation error:', err);

// After:
import { createLogger } from '../lib/logger.js';
const log = createLogger('AlertEngine');
log.info('Starting evaluation loop');
log.error('Evaluation error', { error: err instanceof Error ? err.message : String(err) });
```

**Affected files (all 10+ files with console.* calls):**
- `packages/server/src/index.ts`
- `packages/server/src/lib/alert-engine.ts`
- `packages/server/src/lib/guardrails/engine.ts`
- `packages/server/src/routes/context.ts`
- `packages/server/src/routes/events.ts`
- `packages/server/src/routes/recall.ts`
- `packages/server/src/routes/tenant-helper.ts`
- `packages/server/src/lib/embeddings/worker.ts`
- `packages/server/src/db/sqlite-store.ts`
- `packages/server/src/db/embedding-store.ts`

### 4.3 Type-Safe Error Handling (cq-003)

**New file: `packages/core/src/errors.ts`**

```typescript
/**
 * Safely extracts an error message from an unknown caught value.
 * Use in catch blocks: `catch (err: unknown) { getErrorMessage(err) }`
 */
export function getErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  return String(err);
}
```

**Export from core package:**

```typescript
// packages/core/src/index.ts
export { getErrorMessage } from './errors.js';
```

**Dashboard migration (14 instances):**

```typescript
// Before (TeamManagement.tsx, repeated 6 times):
} catch (err: any) {
  setError(err.message);
}

// After:
import { getErrorMessage } from '@agentlensai/core';
} catch (err: unknown) {
  setError(getErrorMessage(err));
}
```

**Server migration (guardrails/actions.ts, 4 instances):**

```typescript
// Before:
} catch (err) {
  return { success: false, result: `failed: ${err instanceof Error ? err.message : 'Unknown'}` };
}

// After:
import { getErrorMessage } from '@agentlensai/core';
} catch (err: unknown) {
  return { success: false, result: `failed: ${getErrorMessage(err)}` };
}
```

### 4.4 Dashboard Test Infrastructure & Coverage (cq-004)

**New file: `packages/dashboard/vitest.config.ts`**

```typescript
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test-setup.ts'],
    globals: true,
    css: false,
  },
});
```

**New file: `packages/dashboard/src/test-setup.ts`**

```typescript
import '@testing-library/jest-dom';
```

**Test file structure:**

```
packages/dashboard/src/
├── hooks/__tests__/
│   ├── useApi.test.ts
│   └── useSSE.test.ts
├── api/__tests__/
│   └── core.test.ts
├── pages/__tests__/
│   ├── Overview.test.tsx
│   ├── Analytics.test.tsx
│   ├── Settings.test.tsx
│   ├── Events.test.tsx
│   ├── Alerts.test.tsx
│   ├── SessionDetail.test.tsx
│   ├── GuardrailForm.test.tsx
│   ├── BenchmarkDetail.test.tsx
│   ├── Lessons.test.tsx
│   └── HealthOverview.test.tsx
└── components/__tests__/
    └── PageSkeleton.test.tsx
```

**Priority order:**
1. `useApi.test.ts` / `useSSE.test.ts` — hooks used by every page
2. `core.test.ts` — API request helper, error handling
3. Page smoke tests — render each page with mocked API, verify no crash

### 4.5 SqliteEventStore Decomposition (cq-005)

**Target structure:**

```
packages/server/src/db/
├── sqlite-store.ts         # Facade (delegates to repositories)
├── repositories/
│   ├── event-repository.ts    # insertEvents, queryEvents, getEvent, countEvents, 
│   │                          # getSessionTimeline, getLastEventHash, countEventsBatch
│   ├── session-repository.ts  # querySessions, getSession, upsertSession
│   ├── agent-repository.ts    # listAgents, getAgent, upsertAgent, pauseAgent, 
│   │                          # unpauseAgent, setModelOverride
│   ├── alert-repository.ts    # createAlertRule, updateAlertRule, deleteAlertRule, 
│   │                          # listAlertRules, getAlertRule, insertAlertHistory, 
│   │                          # listAlertHistory
│   └── analytics-repository.ts # getAnalytics, getStats
├── services/
│   └── retention-service.ts   # applyRetention
└── shared/
    └── query-helpers.ts       # Shared query building, row mapping helpers
```

**Facade pattern:**

```typescript
// packages/server/src/db/sqlite-store.ts (after refactoring)

import { EventRepository } from './repositories/event-repository.js';
import { SessionRepository } from './repositories/session-repository.js';
import { AgentRepository } from './repositories/agent-repository.js';
import { AlertRepository } from './repositories/alert-repository.js';
import { AnalyticsRepository } from './repositories/analytics-repository.js';
import { RetentionService } from './services/retention-service.js';

export class SqliteEventStore implements IEventStore {
  private events: EventRepository;
  private sessions: SessionRepository;
  private agents: AgentRepository;
  private alerts: AlertRepository;
  private analytics: AnalyticsRepository;
  private retention: RetentionService;

  constructor(db: Database) {
    this.events = new EventRepository(db);
    this.sessions = new SessionRepository(db);
    this.agents = new AgentRepository(db);
    this.alerts = new AlertRepository(db);
    this.analytics = new AnalyticsRepository(db);
    this.retention = new RetentionService(db);
  }

  // Delegate all methods
  async insertEvents(events: AgentLensEvent[]) { return this.events.insert(events); }
  async queryEvents(query: EventQuery) { return this.events.query(query); }
  async getEvent(id: string) { return this.events.getById(id); }
  async countEvents(filter: CountFilter) { return this.events.count(filter); }
  async countEventsBatch(...args) { return this.events.countBatch(...args); }
  
  async querySessions(query: SessionQuery) { return this.sessions.query(query); }
  async getSession(id: string) { return this.sessions.getById(id); }
  async upsertSession(session: Session) { return this.sessions.upsert(session); }
  
  async listAgents() { return this.agents.list(); }
  async getAgent(id: string) { return this.agents.getById(id); }
  async pauseAgent(id: string) { return this.agents.pause(id); }
  
  async createAlertRule(rule: AlertRule) { return this.alerts.createRule(rule); }
  async listAlertRules(tenantId?: string) { return this.alerts.listRules(tenantId); }
  
  async getAnalytics(query: AnalyticsQuery) { return this.analytics.getAnalytics(query); }
  async getStats() { return this.analytics.getStats(); }
  
  async applyRetention(days: number) { return this.retention.apply(days); }
  
  // ... all other delegations
}
```

**Migration strategy:**
1. Ensure comprehensive test coverage exists (cq-004 must be done first for related areas)
2. Extract shared query helpers to `shared/query-helpers.ts`
3. Extract each repository one at a time, running tests after each extraction
4. Convert SqliteEventStore to facade last
5. Verify all tests pass

---

## 5. Documentation Architecture

### 5.1 File Inventory

| File | Type | Status |
|------|------|--------|
| `CONTRIBUTING.md` | New | doc-001 |
| `docs/guide/troubleshooting.md` | New | doc-005 |
| `packages/core/src/discovery-types.ts` | Modified (JSDoc) | doc-002 |
| `packages/core/src/community-types.ts` | Modified (JSDoc) | doc-002 |
| `packages/core/src/redaction-types.ts` | Modified (JSDoc) | doc-002 |
| `packages/core/src/hash.ts` | Modified (comments) | doc-004 |
| `packages/server/src/services/guardrail-evaluator.ts` | Modified (comments) | doc-004 |
| `packages/server/src/routes/delegation.ts` | Modified (JSDoc) | doc-003 |
| `packages/server/src/routes/community.ts` | Modified (JSDoc) | doc-003 |
| `packages/server/src/routes/discovery.ts` | Modified (JSDoc) | doc-003 |
| `packages/server/src/routes/guardrails.ts` | Modified (JSDoc) | doc-003 |
| `packages/server/src/routes/benchmarks.ts` | Modified (JSDoc) | doc-003 |
| `README.md` | Modified (links) | doc-001, doc-005 |
| `.env.example` | Modified (PORT fix) | doc-005, sec-002 |

### 5.2 JSDoc Pattern (doc-002)

Following the established pattern from `packages/core/src/types.ts`:

```typescript
// packages/core/src/discovery-types.ts

/** 
 * Registration of an agent's capabilities for the discovery mesh.
 * Used by agents to advertise what tasks they can handle.
 */
export interface CapabilityRegistration {
  /** Unique identifier for this agent in the discovery mesh. */
  agentId: string;
  
  /** Human-readable name for this agent. */
  name: string;
  
  /** 
   * Trust score as a percentile (0-100). 
   * Scores below 50 are marked provisional.
   * Computed from success rate, completion history, and peer ratings.
   * @see docs/discovery-delegation.md
   */
  trustScorePercentile: number;
  
  /** 
   * Whether this agent's trust score is still being established.
   * True for agents with fewer than 10 completed delegations.
   */
  provisional: boolean;
  
  // ... all fields documented
}
```

### 5.3 Route Handler JSDoc Pattern (doc-003)

```typescript
// packages/server/src/routes/delegation.ts

/**
 * Create a new delegation request.
 * 
 * @summary Delegate a task to another agent via the discovery mesh.
 * @description Finds a suitable agent based on the task type and required capabilities,
 *   creates a delegation record, and initiates the handoff. The delegation goes through
 *   phases: pending → accepted → in_progress → completed/failed.
 * 
 * @param agentId - Path parameter. The delegating agent's ID.
 * @body {object} request
 * @body {string} request.targetAnonymousId - Required. Target agent's anonymous ID.
 * @body {string} request.taskType - Required. One of: 'research', 'code', 'analysis', etc.
 * @body {number} [request.timeoutMs=30000] - Optional. Delegation timeout in milliseconds.
 * @body {boolean} [request.fallbackEnabled=true] - Optional. Whether to try fallback agents.
 * @body {number} [request.maxRetries=3] - Optional. Maximum retry attempts.
 * 
 * @returns {object} 201 - Delegation created successfully
 * @returns {object} 400 - Invalid request (missing required fields)
 * @returns {object} 404 - Target agent not found
 * @returns {object} 409 - Agent already has an active delegation
 * 
 * @example
 * curl -X POST http://localhost:3400/api/delegate/agent-1 \
 *   -H "Content-Type: application/json" \
 *   -d '{"targetAnonymousId":"anon-2","taskType":"research"}'
 */
app.post('/api/delegate/:agentId', async (c) => { ... });
```

---

## 6. Migration & Compatibility

### 6.1 Breaking Change Assessment

| Change | Breaking? | Migration Path |
|--------|-----------|---------------|
| Pool server auth | Yes (intentional) | Set `POOL_API_KEY` env var; public endpoints remain open |
| Secure defaults | Potentially | Existing `.env` files with explicit values unaffected; only fresh installs change |
| CORS restriction | Potentially | Set `CORS_ORIGIN` explicitly if using non-default origin |
| OTLP auth | No | Opt-in via `OTLP_AUTH_TOKEN` env var; unset = no auth (current behavior) |
| Error message format | No | Clients should not depend on error message content |
| Structured logger output | Log format change | Consumers of raw logs need to handle JSON format |
| API client split | No | Barrel re-export preserves all import paths |
| SqliteEventStore decomposition | No | Facade preserves IEventStore interface |

### 6.2 Environment Variable Changes

| Variable | Default Before | Default After | Notes |
|----------|---------------|---------------|-------|
| `AUTH_DISABLED` | `true` | `false` | .env.example only; existing .env files unaffected |
| `CORS_ORIGIN` | `*` | `http://localhost:3400` | Config default change |
| `LOG_LEVEL` | N/A (new) | `info` | New variable |
| `POOL_API_KEY` | N/A (new) | unset (no auth) | New; must set to enable pool auth |
| `POOL_ADMIN_KEY` | N/A (new) | unset (falls back to POOL_API_KEY) | New |
| `OTLP_AUTH_TOKEN` | N/A (new) | unset (no auth) | New; opt-in |
| `ALERT_CHECK_INTERVAL_MS` | N/A (new) | `60000` | New |
| `PORT` | `3000` (.env.example) | `3400` | Fix discrepancy |

---

## 7. Testing Strategy

### 7.1 Test Coverage Targets

| Package | Current | Target | Notes |
|---------|---------|--------|-------|
| Dashboard | 12% (7/59 files) | ≥50% (30+/59) | Priority: hooks, API client, top 10 pages |
| Server | 82% | ≥82% | Maintain; add tests for new logger, error sanitizer |
| Core | 142% | ≥142% | Maintain; add tests for getErrorMessage |
| Pool Server | Unknown | ≥80% | Add tests for auth middleware, bounded rate limiter |

### 7.2 Test Types per Change

| Change | Unit Tests | Integration Tests | E2E Tests |
|--------|-----------|------------------|-----------|
| Pool server auth | Auth middleware, scope validation | Route-level auth enforcement | — |
| Secure defaults | Config parsing | Server startup with various configs | — |
| Bounded rate limiter | Map size limits, cleanup, eviction | — | — |
| Error sanitization | Sanitizer utility | Global handler, route catch blocks | — |
| Batch guardrail queries | SQL correctness | Evaluation cycle with real DB | — |
| Pool indexes | Index consistency, search accuracy | Search with filters at scale | — |
| Alert cache | Cache hit/miss, grouping logic | Evaluation cycle with dedup | — |
| Dashboard overview | — | — | Page load network calls |
| Code splitting | — | — | Navigation, chunk loading |
| API client split | Import resolution | — | Build verification |
| Structured logger | Level filtering, JSON output | — | — |
| Error handling utility | All input types | — | — |
| Dashboard tests | Hooks, API client, page renders | — | — |
| SqliteEventStore split | All repository methods | Same integration suite | — |

---

*End of architecture document. ~54 files modified, ~30 files created, 1 file deleted. Zero new runtime dependencies. Full backward compatibility via env vars and facade patterns.*
