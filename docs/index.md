---
layout: home

hero:
  name: AgentLens
  text: Observability for AI Agents
  tagline: Open-source flight recorder for every tool call, approval, and data exchange your agents make.
  image:
    src: /logo.svg
    alt: AgentLens
  actions:
    - theme: brand
      text: Get Started
      link: /guide/getting-started
    - theme: alt
      text: View on GitHub
      link: https://github.com/amitpaz/agentlens

features:
  - icon: 🔌
    title: MCP-Native
    details: Ships as an MCP server — add one config block and every tool call is captured automatically. Zero code changes.
  - icon: 📊
    title: Real-Time Dashboard
    details: Session timelines, event explorer, cost analytics, and alerting — all in a beautiful web UI served by the same process.
  - icon: 🔗
    title: AgentKit Ecosystem
    details: First-class integrations with AgentGate (approval flows) and FormBridge (data collection). See the full agent lifecycle in one timeline.
  - icon: 🔒
    title: Tamper-Evident Audit Trail
    details: Append-only event storage with SHA-256 hash chains. Every event is immutable and cryptographically linked.
  - icon: 💰
    title: Cost Tracking
    details: Track token usage and estimated costs per session, per agent, over time. Set alerts for cost spikes before they become budget disasters.
  - icon: 🏠
    title: Self-Hosted & Open Source
    details: MIT licensed. SQLite by default — no external dependencies. Your data stays on your infrastructure.
---

## Quick Start

Get AgentLens running in 60 seconds:

```bash
# Install and start the server
npx @agentlens/server

# Create an API key
curl -X POST http://localhost:3400/api/keys \
  -H "Content-Type: application/json" \
  -d '{"name": "my-agent"}'
```

Then add AgentLens to your MCP agent config:

```json
{
  "mcpServers": {
    "agentlens": {
      "command": "npx",
      "args": ["@agentlens/mcp"],
      "env": {
        "AGENTLENS_API_URL": "http://localhost:3400",
        "AGENTLENS_API_KEY": "als_your_key_here"
      }
    }
  }
}
```

Open **http://localhost:3400** and watch your agent's activity in real time.

→ [Full Getting Started Guide](/guide/getting-started)
