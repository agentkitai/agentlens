#!/usr/bin/env bash
#
# AgentLens — 30-second tamper-evident audit-log demo.
#
# Ingests a real agent trace, verifies the SHA-256 hash chain (passes),
# tampers with one record directly in the database, then re-verifies
# (fails — the chain catches it). This is the moat: an append-only,
# cryptographically verifiable audit log for AI agents.
#
#   ./demo/aha.sh
#
# Requires: docker, curl. No agentlens install, no config, no cloud.
set -euo pipefail

IMAGE="${AGENTLENS_IMAGE:-ghcr.io/agentkitai/agentlens:latest}"
NAME="agentlens-aha-demo"
PORT="${PORT:-3400}"
DB_PATH="${AGENTLENS_DB_PATH:-/app/data/agentlens.db}"
BASE="http://localhost:${PORT}"
SESSION="demo-session-$(date +%s)"

cleanup() { docker rm -f "$NAME" >/dev/null 2>&1 || true; }
trap cleanup EXIT

echo "🔍 AgentLens — tamper-evident audit-log demo"
echo

# 1. Start the server: SQLite, zero external dependencies, auth off for the demo.
echo "1/5  Starting AgentLens (SQLite, zero-config)…"
cleanup
docker run -d --name "$NAME" -p "${PORT}:3400" \
  -e AUTH_DISABLED=true \
  -e DATABASE_PATH="$DB_PATH" \
  "$IMAGE" >/dev/null

# Wait for the health endpoint (max ~30s).
for i in $(seq 1 30); do
  curl -fs "${BASE}/api/stats" >/dev/null 2>&1 && break
  [ "$i" = 30 ] && { echo "   ✗ server did not become healthy"; docker logs "$NAME"; exit 1; }
  sleep 1
done
echo "   ✓ up at ${BASE}  (dashboard in your browser, API here)"

# 2. Ingest a realistic 5-event agent trace into one session.
echo "2/5  Ingesting a 5-event agent trace…"
# Explicit increasing timestamps so verification's ordering matches ingest order
# (a same-millisecond batch is ambiguous to order by time).
curl -fs -X POST "${BASE}/api/events" -H 'Content-Type: application/json' -d @- >/dev/null <<JSON
{ "events": [
  { "sessionId": "${SESSION}", "agentId": "research-agent", "eventType": "session_started",
    "timestamp": "2026-01-01T10:00:00.000Z", "payload": { "agentName": "research-agent" } },
  { "sessionId": "${SESSION}", "agentId": "research-agent", "eventType": "llm_call",
    "timestamp": "2026-01-01T10:00:01.000Z",
    "payload": { "callId": "c1", "provider": "anthropic", "model": "claude-opus-4-8",
                 "messages": [ { "role": "user", "content": "What is the capital of France?" } ] } },
  { "sessionId": "${SESSION}", "agentId": "research-agent", "eventType": "tool_call",
    "timestamp": "2026-01-01T10:00:02.000Z",
    "payload": { "callId": "t1", "toolName": "web_search", "arguments": { "q": "capital of France" } } },
  { "sessionId": "${SESSION}", "agentId": "research-agent", "eventType": "llm_response",
    "timestamp": "2026-01-01T10:00:03.000Z",
    "payload": { "callId": "c1", "provider": "anthropic", "model": "claude-opus-4-8",
                 "completion": "Paris.", "finishReason": "stop",
                 "usage": { "inputTokens": 12, "outputTokens": 3, "totalTokens": 15 },
                 "costUsd": 0.0004, "latencyMs": 820 } },
  { "sessionId": "${SESSION}", "agentId": "research-agent", "eventType": "session_ended",
    "timestamp": "2026-01-01T10:00:04.000Z", "payload": { "reason": "completed" } }
] }
JSON
echo "   ✓ 5 events ingested into session ${SESSION}"

verify() { curl -fs "${BASE}/api/audit/verify?sessionId=${SESSION}"; }

# 3. Verify the chain — should be intact.
echo "3/5  Verifying the hash chain…"
RESULT="$(verify)"
case "$RESULT" in
  *'"verified":true'*) echo "   ✓ CHAIN VALID — no tampering detected";;
  *) echo "   ✗ expected a valid chain but got: $RESULT"; exit 1;;
esac

# 4. Tamper: edit one event's payload directly in the DB, behind the audit log's back.
#    Uses the container's own better-sqlite3 — nothing to install on the host.
echo "4/5  Tampering with one event directly in the database…"
TAMPERED_ID="$(docker exec -w /app "$NAME" node -e '
  const Database = require("better-sqlite3");
  const db = new Database(process.env.DATABASE_PATH);
  const row = db.prepare("SELECT id FROM events WHERE event_type=? LIMIT 1").get("llm_call");
  db.prepare("UPDATE events SET payload=? WHERE id=?")
    .run(JSON.stringify({ callId: "c1", provider: "anthropic", model: "gpt-3.5-turbo", messages: [{ role: "user", content: "edited after the fact" }] }), row.id);
  process.stdout.write(row.id);
')"
echo "   ✓ altered llm_call event ${TAMPERED_ID} (changed the logged model)"

# 5. Re-verify — the chain must now fail.
echo "5/5  Re-verifying the hash chain…"
RESULT="$(verify)"
case "$RESULT" in
  *'"verified":false'*) echo "   ✗ CHAIN BROKEN — tampering detected ✅";;
  *) echo "   ⚠ expected a broken chain but got: $RESULT"; exit 1;;
esac

echo
echo "That's the moat: every event is SHA-256 hash-chained to the previous one,"
echo "so any after-the-fact edit, deletion, or reorder breaks verification."
echo "Signed export for auditors:  GET ${BASE}/api/audit/verify/export"
