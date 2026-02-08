# Dashboard

AgentLens includes a built-in web dashboard served by the same Hono process. Open **http://localhost:3400** after starting the server.

## Pages

### Overview

The landing page shows a metrics grid with:

- Total sessions (with trend)
- Total events captured
- Active sessions count
- Error rate percentage
- Total estimated cost

### Sessions

A filterable, sortable table of all agent sessions:

- **Filters:** Agent ID, status (active / completed / error), date range, tags
- **Columns:** Agent name, status, started at, duration, event count, tool calls, errors, cost
- **Search:** Full-text search across agent names and session IDs

Click any session to view its detail page.

### Session Detail

A vertical timeline showing every event in chronological order:

- Each event shows: timestamp, event type icon, summary, duration
- Expand any event to see its full JSON payload with syntax highlighting
- **Hash chain verification:** A badge indicates whether the event chain is valid (tamper-evident)
- Color-coded by event type:
  - 🔵 Tool calls
  - 🟢 Tool responses
  - 🔴 Errors
  - 🟡 Approval events (from AgentGate)
  - 🟣 Form events (from FormBridge)
  - 💰 Cost tracking events

### Events Explorer

A filterable list of all events across all sessions:

- **Filters:** Event type, severity, agent ID, session ID, date range
- **Full-text search:** Search within event payloads
- **Detail panel:** Click any event to see its full payload

### Analytics

Charts and metrics for understanding agent behavior:

- **Event trends:** Events over time, grouped by hour/day/week
- **Cost breakdown:** Cost by agent, cost over time
- **Agent comparison:** Session count, error rate, avg duration per agent
- **Tool usage:** Most-used tools, error rates, average duration per tool

### Alerts

Configure and manage alert rules:

- **Create rules:** Error rate exceeds threshold, cost spikes, latency anomalies, inactivity
- **Alert history:** View triggered and resolved alerts with timestamps
- **Notification channels:** Webhook URLs for external notifications

### Health Overview

A dedicated view for agent reliability monitoring:

- **Agent list** — every agent with their overall health score (0–100), trend arrow, and session count
- **Dimension breakdown** — click any agent to see the 5-dimension radar: error rate, cost efficiency, tool success, latency, completion rate
- **Historical chart** — sparkline of daily health snapshots showing the trend over time
- **Color coding** — scores are green (≥75), yellow (50–74), or red (<50)

### Cost Optimization

Actionable recommendations for reducing LLM costs:

- **Recommendation cards** — each shows current model → recommended model, complexity tier, projected monthly savings, and confidence level
- **Summary metrics** — total potential savings, analyzed calls, analysis period
- **Success rate comparison** — current vs. recommended success rates to assess risk
- **Agent filter** — narrow recommendations to a specific agent

### Session Replay

Step-through debugger for past sessions:

- **Timeline scrubber** — drag or click to jump to any step in the session
- **Step list** — numbered, timestamped events with type icons (🤖 LLM, 🔧 tool, ⚠️ error)
- **Context panel** — at each step shows: cumulative cost, LLM conversation history, tool results, pending approvals, error count, warnings
- **Event type filter** — focus on specific interaction types
- **Playback controls** — play/pause, step forward/back, speed adjustment

### Benchmarks

A/B experiment management:

- **Benchmark list** — all benchmarks with status badges (📝 draft, 🏃 running, ✅ completed, ❌ cancelled)
- **Create form** — define name, description, variants (name + tag), metrics, and optional time range
- **Detail view** — per-variant session counts, progress toward minimum sessions, lifecycle action buttons
- **Results view** — statistical comparison table with p-values, confidence stars, winner indication, and distribution charts per metric

### Settings

Configure integration secrets and server settings:

- Retention policy (days)
- AgentGate webhook secret
- FormBridge webhook secret
