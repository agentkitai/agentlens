# AgentLens Go SDK

Official Go client for the [AgentLens](https://github.com/agentkitai/agentlens) observability platform.

## Installation

```bash
go get github.com/agentkitai/agentlens-go
```

**Requirements:** Go 1.21+ | Zero external dependencies (stdlib only)

## Quick Start

```go
package main

import (
    "context"
    "fmt"
    agentlens "github.com/agentkitai/agentlens-go"
)

func main() {
    // From environment: AGENTLENS_SERVER_URL, AGENTLENS_API_KEY
    client := agentlens.NewClientFromEnv()

    // Or explicit
    client = agentlens.NewClient("http://localhost:3400", "your-api-key")

    // Check health
    health, _ := client.Health(context.Background())
    fmt.Println(health.Status)
}
```

## Configuration

| Option | Default | Description |
|--------|---------|-------------|
| `WithTimeout(d)` | 30s | HTTP request timeout |
| `WithRetry(cfg)` | 3 retries, 1s base, 30s max | Retry configuration |
| `WithHTTPClient(c)` | default | Custom `*http.Client` |
| `WithFailOpen(onErr)` | disabled | Swallow errors, call callback |
| `WithLogger(l)` | nil | `*slog.Logger` for warnings |

## Environment Variables

| Variable | Description |
|----------|-------------|
| `AGENTLENS_SERVER_URL` | Server URL (default `http://localhost:3400`) |
| `AGENTLENS_API_KEY` | Bearer token for authentication |
| `AGENTLENS_BUFFER_DIR` | Disk buffer directory for BatchSender |

## API Methods

All methods take `context.Context` as the first parameter.

### Events
- `QueryEvents(ctx, query)` — Query events with filters
- `GetEvent(ctx, id)` — Get single event

### Sessions
- `GetSessions(ctx, query)` — Query sessions
- `GetSession(ctx, id)` — Get single session
- `GetSessionTimeline(ctx, id)` — Get session event timeline

### Agents
- `GetAgent(ctx, id)` — Get agent details

### LLM Tracking
- `LogLlmCall(ctx, sessionID, agentID, params)` — Log an LLM call
- `GetLlmAnalytics(ctx, params)` — Get LLM analytics

### Memory
- `Recall(ctx, query)` — Semantic search
- `Reflect(ctx, query)` — Pattern analysis
- `GetContext(ctx, query)` — Cross-session context

### Health
- `Health(ctx)` — Server health (no auth)
- `GetHealth(ctx, agentID, window)` — Agent health score
- `GetHealthOverview(ctx, window)` — All agents health
- `GetHealthHistory(ctx, agentID, days)` — Historical health

### Optimization
- `GetOptimizationRecommendations(ctx, opts)` — Cost recommendations

### Guardrails
- `ListGuardrails(ctx, opts)` / `GetGuardrail(ctx, id)`
- `CreateGuardrail(ctx, params)` / `UpdateGuardrail(ctx, id, params)`
- `DeleteGuardrail(ctx, id)`
- `EnableGuardrail(ctx, id)` / `DisableGuardrail(ctx, id)`
- `GetGuardrailHistory(ctx, opts)` / `GetGuardrailStatus(ctx, id)`

### Audit
- `VerifyAudit(ctx, params)` — Verify hash chain integrity

## Error Handling

```go
import "errors"

result, err := client.GetEvent(ctx, "missing-id")
if err != nil {
    var notFound *agentlens.NotFoundError
    var authErr  *agentlens.AuthenticationError
    var rateErr  *agentlens.RateLimitError

    switch {
    case errors.As(err, &notFound):
        // 404
    case errors.As(err, &authErr):
        // 401
    case errors.As(err, &rateErr):
        fmt.Printf("retry after: %v\n", rateErr.RetryAfter)
    }
}
```

## BatchSender

For high-throughput event ingestion:

```go
bs := agentlens.NewBatchSender(client.SendEvents,
    agentlens.WithMaxBatchSize(200),
    agentlens.WithFlushInterval(3*time.Second),
)

bs.Enqueue(event)

// Graceful shutdown
ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
defer cancel()
bs.Shutdown(ctx)
```

## License

See repository root.
