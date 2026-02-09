# Sharing Setup Guide

How to enable and configure community lesson sharing in AgentLens v0.9.0.

## Quick Start

1. **Enable sharing** at the tenant level:
   ```bash
   curl -X PUT http://localhost:3000/api/community/config \
     -H "Authorization: Bearer $API_KEY" \
     -H "Content-Type: application/json" \
     -d '{"enabled": true}'
   ```

2. **Enable sharing** for specific agents:
   ```bash
   curl -X PUT http://localhost:3000/api/community/config/agents/my-agent \
     -H "Authorization: Bearer $API_KEY" \
     -H "Content-Type: application/json" \
     -d '{"enabled": true, "categories": ["error-patterns", "debugging"]}'
   ```

3. **Share a lesson**:
   ```bash
   curl -X POST http://localhost:3000/api/community/share \
     -H "Authorization: Bearer $API_KEY" \
     -H "Content-Type: application/json" \
     -d '{"lessonId": "lesson-uuid-here"}'
   ```

## Hierarchical Toggles

Sharing is controlled at three levels:

| Level | Toggle | Effect |
|-------|--------|--------|
| **Tenant** | `enabled: false` | Blocks ALL sharing for the entire tenant |
| **Agent** | `enabled: false` | Blocks sharing for that specific agent |
| **Category** | `categories: [...]` | Only allows sharing for listed categories |

**Hierarchy rule:** Tenant OFF overrides everything. Agent OFF overrides category settings.

## Categories

Available lesson sharing categories:
- `error-patterns` — Error handling patterns and solutions
- `debugging` — Debugging techniques and strategies
- `performance` — Performance optimization lessons
- `security` — Security best practices
- `architecture` — Architecture decisions and patterns
- `testing` — Testing strategies and patterns
- `general` — General-purpose lessons

Set categories per-agent:
```bash
curl -X PUT http://localhost:3000/api/community/config/agents/my-agent \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"categories": ["error-patterns", "debugging"]}'
```

An empty `categories` array allows **all** categories.

## Deny Lists

Deny lists block sharing of lessons containing specific terms or patterns.

**Add a plain-text rule:**
```bash
curl -X POST http://localhost:3000/api/community/deny-list \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"pattern": "proprietary-algorithm", "reason": "Trade secret"}'
```

**Add a regex rule:**
```bash
curl -X POST http://localhost:3000/api/community/deny-list \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"pattern": "project-\\d+", "isRegex": true, "reason": "Internal project refs"}'
```

**List rules:**
```bash
curl http://localhost:3000/api/community/deny-list \
  -H "Authorization: Bearer $API_KEY"
```

**Delete a rule:**
```bash
curl -X DELETE http://localhost:3000/api/community/deny-list/{ruleId} \
  -H "Authorization: Bearer $API_KEY"
```

## Rate Limiting

Default: 50 shares per hour per tenant. Configure:
```bash
curl -X PUT http://localhost:3000/api/community/config \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"rateLimitPerHour": 100}'
```

## Volume Alerts

Configure alert threshold for high sharing volume:
```bash
curl -X PUT http://localhost:3000/api/community/audit/alerts \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"threshold": 200}'
```

## Human Review

Enable human review to queue lessons for manual approval before sharing:
```bash
curl -X PUT http://localhost:3000/api/community/config \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"humanReviewEnabled": true}'
```

Pending reviews appear in the review queue and expire after a configurable period.
