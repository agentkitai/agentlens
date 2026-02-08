# A/B Benchmarking

AgentLens includes a full A/B benchmarking system for comparing agent variants with statistical rigor. Create experiments, tag sessions with variant identifiers, collect data, and get results with p-values and confidence intervals.

## Concepts

### Variants

A **variant** represents one configuration you want to test — e.g., a specific model, prompt template, or parameter set. Each variant has:

- **Name** — display name (e.g., "GPT-4o")
- **Tag** — session tag used to associate sessions with this variant (e.g., `v-gpt4o`)
- **Agent ID** — optional, if the variant uses a different agent

You need at least **2 variants** per benchmark, up to a maximum of 10.

### Metrics

Benchmarks compare variants across one or more metrics:

| Metric | Description |
|---|---|
| `error_rate` | Percentage of sessions with errors |
| `avg_cost` | Average cost per session (USD) |
| `avg_latency` | Average LLM call latency (ms) |
| `tool_success_rate` | Ratio of successful tool calls |
| `completion_rate` | Percentage of completed sessions |
| `avg_tokens` | Average tokens per session |
| `avg_duration` | Average session duration (ms) |

> **Note:** `health_score` is defined as a metric type but not yet supported for benchmarks — it requires pre-computed health snapshots.

### Statistical Analysis

Results use proper statistical tests:

- **Welch's t-test** — for continuous metrics (cost, latency, tokens, duration). Does not assume equal variance.
- **Chi-squared test** — for rate metrics (error rate, success rate, completion rate).
- **Confidence levels:**
  - ★★★ `p < 0.01` — Strong evidence
  - ★★ `p < 0.05` — Moderate evidence
  - ★ `p < 0.1` — Weak evidence
  - — `p ≥ 0.1` — Not significant

Results also include **effect size** (Cohen's d or phi coefficient) and **95% confidence intervals**.

### Lifecycle

Benchmarks follow a status lifecycle:

```
draft → running → completed
  │                   ↑
  └──→ cancelled ─────┘ (terminal)
```

- **Draft** — Configuration defined, not yet collecting data
- **Running** — Actively collecting sessions. Can't be deleted.
- **Completed** — Results computed and cached. Can't be deleted.
- **Cancelled** — Abandoned. Terminal state.

## Workflow

### 1. Create a Benchmark

Define the experiment — what you're comparing, which metrics to track:

**MCP:**
```
agentlens_benchmark({
  action: "create",
  name: "GPT-4o vs Claude Sonnet",
  variants: [
    { name: "GPT-4o", tag: "v-gpt4o" },
    { name: "Claude Sonnet", tag: "v-claude-sonnet" }
  ],
  metrics: ["avg_cost", "avg_latency", "error_rate", "completion_rate"]
})
```

**REST:**
```bash
curl -X POST http://localhost:3400/api/benchmarks \
  -H "Authorization: Bearer als_your_key" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "GPT-4o vs Claude Sonnet",
    "variants": [
      { "name": "GPT-4o", "tag": "v-gpt4o" },
      { "name": "Claude Sonnet", "tag": "v-claude-sonnet" }
    ],
    "metrics": ["avg_cost", "avg_latency", "error_rate", "completion_rate"]
  }'
```

### 2. Tag Sessions

When starting sessions, include the variant tag so the benchmark engine can associate sessions with variants. How you tag depends on your integration:

- **MCP:** Include the tag in your session metadata
- **Python SDK:** Pass `tags=["v-gpt4o"]` when creating sessions
- **REST:** Include `tags` in the session start event

### 3. Start the Benchmark

Transition from `draft` to `running`. Each variant must have at least 1 session.

```
agentlens_benchmark({ action: "start", benchmarkId: "bench_abc123" })
```

### 4. Collect Data

Run your agents with different configurations. The more sessions per variant, the more statistically powerful the results. As a rule of thumb:

| Sessions per variant | Statistical power |
|---|---|
| < 10 | Low — results may be unreliable |
| 10–30 | Moderate — can detect large effects |
| 30–100 | Good — can detect moderate effects |
| 100+ | High — can detect small effects |

### 5. Check Progress

```
agentlens_benchmark({ action: "status", benchmarkId: "bench_abc123" })
```

Shows session counts per variant and current status.

### 6. Get Results

```
agentlens_benchmark({ action: "results", benchmarkId: "bench_abc123" })
```

Returns a formatted comparison table:

```
✅ Benchmark Results: GPT-4o vs Claude Sonnet

| Metric          | GPT-4o       | Claude Sonnet | p-value        | Result              |
|-----------------|--------------|---------------|----------------|---------------------|
| avg_cost        | 0.03±0.01    | 0.02±0.01     | 0.0023         | Claude Sonnet wins ★★★ |
| avg_latency     | 1200±300     | 890±250       | 0.0156         | Claude Sonnet wins ★★  |
| error_rate      | 0.05±0.22    | 0.04±0.20     | 0.7812         | no sig. diff.       |
| completion_rate | 0.95±0.22    | 0.96±0.20     | 0.6543         | no sig. diff.       |

Confidence: ★ p<0.1  ★★ p<0.05  ★★★ p<0.01
```

### 7. Complete the Benchmark

```
agentlens_benchmark({ action: "complete", benchmarkId: "bench_abc123" })
```

Finalizes the benchmark, computes and caches results.

## Dashboard

The Benchmarks pages provide a visual interface for the full workflow:

- **Benchmark List** — all benchmarks with status badges, variant names, and action buttons
- **Create Benchmark** — form to define name, variants, metrics, and optional time range
- **Benchmark Detail** — per-variant session counts, progress toward minimum sessions, and action buttons for lifecycle transitions
- **Results** — statistical comparison table with distribution charts for each metric

## REST API Endpoints

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/benchmarks` | Create a benchmark |
| `GET` | `/api/benchmarks` | List benchmarks (filter by status, agentId) |
| `GET` | `/api/benchmarks/:id` | Get benchmark detail with session counts |
| `PUT` | `/api/benchmarks/:id/status` | Transition status (draft→running→completed) |
| `GET` | `/api/benchmarks/:id/results` | Get statistical comparison results |
| `DELETE` | `/api/benchmarks/:id` | Delete draft/cancelled benchmarks |

See [REST API Reference → Benchmarks](../reference/benchmarks.md) for full parameter documentation.

## See Also

- [REST API Reference → Benchmarks](../reference/benchmarks.md)
- [Cost Optimization Guide](./cost-optimization.md) — validate optimization recommendations with benchmarks
- [Health Scores Guide](./health-scores.md) — monitor post-experiment health
