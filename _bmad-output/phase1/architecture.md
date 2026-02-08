# Architecture: AgentLens v0.6.0 — Cost Optimization & Health Scores

**Date:** 2026-02-08
**Status:** Approved

---

## 1. System Context

Both features are server-side additions to the existing AgentLens monorepo. They consume data from the existing `events`, `sessions`, and `agents` tables and expose new endpoints via REST, MCP, CLI, and Dashboard.

```
┌─────────────┐     ┌──────────────┐     ┌───────────────┐
│  MCP Tools   │────▶│  AgentLens   │◀────│   Dashboard   │
│  (agents)    │     │   Server     │     │   (React)     │
└─────────────┘     └──────┬───────┘     └───────────────┘
                           │
                    ┌──────┴───────┐
                    │   SQLite DB   │
                    │  (existing +  │
                    │   new tables) │
                    └──────────────┘
```

## 2. Package Changes

| Package | Changes |
|---------|---------|
| `@agentlensai/core` | New types: `HealthScore`, `HealthDimension`, `HealthTrend`, `CostRecommendation`, `ComplexityTier`, `OptimizationResult` |
| `@agentlensai/server` | New: `lib/health/`, `lib/optimization/`, `db/health-snapshot-store.ts`, `routes/health.ts`, `routes/optimize.ts` |
| `@agentlensai/mcp` | New tools: `agentlens_health`, `agentlens_optimize` |
| `@agentlensai/sdk` | New methods: `getHealth()`, `getHealthOverview()`, `getOptimizationRecommendations()` |
| `@agentlensai/cli` | New commands: `health`, `optimize` |
| `dashboard` | New pages: Health Overview, Cost Optimization |

## 3. Data Model

### 3.1 `health_snapshots` Table

```sql
CREATE TABLE IF NOT EXISTS health_snapshots (
  id TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  date TEXT NOT NULL,              -- YYYY-MM-DD
  overall_score REAL NOT NULL,     -- 0-100
  error_rate_score REAL NOT NULL,
  cost_efficiency_score REAL NOT NULL,
  tool_success_score REAL NOT NULL,
  latency_score REAL NOT NULL,
  completion_rate_score REAL NOT NULL,
  session_count INTEGER NOT NULL,  -- sessions in window
  created_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, agent_id, date)
);

CREATE INDEX idx_health_snapshots_agent ON health_snapshots(tenant_id, agent_id, date DESC);
```

### 3.2 No `optimization_cache` Table (v0.6.0)

Recommendations are computed on-demand from existing data. Caching deferred to v0.7.0+ if performance requires it.

## 4. Cost Optimization Architecture

### 4.1 Complexity Classifier

```typescript
// packages/server/src/lib/optimization/classifier.ts

type ComplexityTier = 'simple' | 'moderate' | 'complex';

interface ClassificationResult {
  tier: ComplexityTier;
  signals: {
    inputTokens: number;
    outputTokens: number;
    toolCallCount: number;
    hasMultiTurn: boolean;
  };
}

function classifyCallComplexity(event: AgentEvent): ClassificationResult {
  // Simple: <500 input tokens, no tools, single turn
  // Moderate: 500-2000 tokens OR 1-3 tools
  // Complex: >2000 tokens OR 4+ tools OR multi-turn
}
```

### 4.2 Recommendation Engine

```typescript
// packages/server/src/lib/optimization/engine.ts

interface CostRecommendation {
  currentModel: string;
  recommendedModel: string;
  complexityTier: ComplexityTier;
  currentCostPerCall: number;
  recommendedCostPerCall: number;
  monthlySavings: number;
  callVolume: number;          // calls in analysis period
  currentSuccessRate: number;
  recommendedSuccessRate: number;
  confidence: 'low' | 'medium' | 'high';
  agentId: string;
}

class OptimizationEngine {
  constructor(
    private readonly store: TenantScopedStore,
    private readonly classifier: ComplexityClassifier,
  ) {}

  async getRecommendations(options: {
    agentId?: string;
    period: number;    // days
    limit: number;
  }): Promise<CostRecommendation[]>;
}
```

### 4.3 Flow

1. Query `llm_call` + `llm_response` events for the period
2. Classify each call by complexity tier
3. Group by (model, complexity_tier, agent_id)
4. For each group, calculate: call count, success rate, avg cost
5. For each expensive model + tier, check if a cheaper model has ≥95% success rate at that tier
6. Generate recommendations sorted by estimated monthly savings

### 4.4 Model Cost Reference

Hardcode known model pricing (can be overridden via config):

```typescript
const MODEL_COSTS: Record<string, { input: number; output: number }> = {
  'gpt-4o': { input: 2.50, output: 10.00 },        // per 1M tokens
  'gpt-4o-mini': { input: 0.15, output: 0.60 },
  'claude-opus-4': { input: 15.00, output: 75.00 },
  'claude-sonnet-4': { input: 3.00, output: 15.00 },
  'claude-haiku-3.5': { input: 0.80, output: 4.00 },
  // ... extensible via config
};
```

## 5. Health Score Architecture

### 5.1 Score Computer

```typescript
// packages/server/src/lib/health/computer.ts

interface HealthDimension {
  name: string;
  score: number;      // 0-100
  weight: number;     // 0-1
  rawValue: number;   // original metric value
  description: string;
}

interface HealthScore {
  agentId: string;
  overallScore: number;      // 0-100, weighted sum
  trend: 'improving' | 'stable' | 'degrading';
  trendDelta: number;        // point change from previous window
  dimensions: HealthDimension[];
  window: { from: string; to: string };
  sessionCount: number;
  computedAt: string;
}

interface HealthWeights {
  errorRate: number;          // default 0.30
  costEfficiency: number;     // default 0.20
  toolSuccess: number;        // default 0.20
  latency: number;            // default 0.15
  completionRate: number;     // default 0.15
}

class HealthComputer {
  constructor(
    private readonly store: TenantScopedStore,
    private readonly weights: HealthWeights,
  ) {}

  async compute(agentId: string, windowDays: number): Promise<HealthScore>;
  async computeOverview(windowDays: number): Promise<HealthScore[]>;
}
```

### 5.2 Dimension Calculations

| Dimension | Raw Metric | Normalization |
|-----------|-----------|---------------|
| Error Rate | `sessions_with_errors / total_sessions` | `(1 - error_rate) * 100` |
| Cost Efficiency | `avg_cost_per_session / baseline_avg_cost` | `clamp(100 - (ratio - 1) * 100, 0, 100)` |
| Tool Success | `successful_tool_calls / total_tool_calls` | `success_rate * 100` |
| Latency | `avg_session_duration / baseline_duration` | `clamp(100 - (ratio - 1) * 50, 0, 100)` |
| Completion Rate | `completed_sessions / total_sessions` | `completion_rate * 100` |

**Baseline:** Agent's own 30-day rolling average (self-relative, not cross-agent comparison).

### 5.3 Trend Calculation

Compare current window score vs previous window (same length):
- Current window: last N days
- Previous window: N to 2N days ago
- Delta = current - previous
- `|delta| > 5` → improving/degrading, else stable

### 5.4 Snapshot Storage

Daily snapshots stored via `HealthSnapshotStore`:
- Computed on first health query of the day (lazy)
- Also computable via CLI: `agentlens health --snapshot`
- Retained 90 days (configurable via server config)

## 6. API Design

### REST Endpoints

```
GET /api/agents/:id/health?window=7
GET /api/health/overview?window=7
GET /api/health/history?agentId=X&days=30
GET /api/config/health-weights
PUT /api/config/health-weights

GET /api/optimize/recommendations?agentId=X&period=7&limit=10
```

### MCP Tools

```
agentlens_health:
  params: { window?: number }
  returns: { overallScore, trend, dimensions[], sessionCount }

agentlens_optimize:
  params: { period?: number, limit?: number }
  returns: { recommendations[], totalPotentialSavings }
```

## 7. Dashboard Pages

### Health Overview Page
- Grid of agent health cards (score circle, trend arrow, sparkline)
- Click card → detailed dimension breakdown
- Filter by: trend direction, score range
- Alert indicators for degrading agents

### Cost Optimization Page
- Recommendations table: current model → recommended model, savings, confidence
- Total potential savings banner
- Cost trend chart (line chart, by model)
- Complexity distribution pie chart

## 8. Migration Strategy

- New `health_snapshots` table added via migration
- No changes to existing tables
- New config key: `health.weights` with defaults
- New config key: `optimization.modelCosts` for custom pricing
- Backward compatible — v0.5.0 clients work unchanged

## 9. Testing Strategy

- Unit tests for complexity classifier (edge cases for each tier)
- Unit tests for recommendation engine (mock data, verify sorting/filtering)
- Unit tests for health score computer (each dimension independently + combined)
- Integration tests for REST endpoints (auth, tenant isolation, query params)
- MCP tool tests (parameter validation, response format)
- SDK method tests (client-side serialization)
- Snapshot store tests (CRUD + tenant isolation + retention)
