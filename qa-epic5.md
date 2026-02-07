# QA Report — Epic 5: MCP Server

## Story 5.1: Implement MCP Server Entrypoint with Stdio Transport
- [PASS] AC1: Given the MCP server is started, When it connects via stdio, Then it logs "AgentLens MCP server running" to stderr — `packages/mcp/src/index.ts` writes exactly that string to `stderr` after `connect`.
- [PASS] AC2: Given `ListToolsRequest`, When received, Then four tools are returned: `agentlens_session_start`, `agentlens_log_event`, `agentlens_session_end`, `agentlens_query_events` — `registerTools` registers all four and tests verify list output.
- [PASS] AC3: Given environment variables `AGENTLENS_URL` and `AGENTLENS_API_KEY`, When the server starts, Then it configures the HTTP transport with these values — `createServer()` reads both env vars and passes them into `AgentLensTransport`.
- [PASS] AC4: Given no `AGENTLENS_URL`, When the server starts, Then it defaults to `http://localhost:3400` — default is implemented directly in `createServer()`.

## Story 5.2: Implement `agentlens_session_start` Tool
- [PASS] AC1: Given the `agentlens_session_start` tool is called with `{ agentId: "my-agent" }`, When processed, Then a new session is created on the server and `{ sessionId: "..." }` is returned — handler generates `sessionId`, sends `session_started` event, and returns JSON `{ sessionId }`.
- [PASS] AC2: Given optional fields (agentName, tags), When provided, Then they are included in the session creation — handler includes both in event payload.
- [PASS] AC3: Given the server is unreachable, When the tool is called, Then a meaningful error message is returned to the agent — handler returns explicit error text on fetch failure/non-OK response.
- [PASS] AC4: Given the tool definition, When inspected, Then `agentId` is required, all other fields are optional — schema requires only `agentId`; `agentName` and `tags` are optional.

## Story 5.3: Implement `agentlens_log_event` Tool
- [PASS] AC1: Given `agentlens_log_event` is called with `{ sessionId, eventType: "tool_call", payload: { toolName: "search" } }`, When processed, Then the event is sent to the server — handler POSTs event via transport to `/api/events`.
- [PASS] AC2: Given a `severity` field, When provided, Then it overrides the default `info` level — uses `severity ?? 'info'`.
- [PASS] AC3: Given a `metadata` field, When provided, Then arbitrary key-value pairs are included — schema accepts `record`, handler forwards metadata.
- [PASS] AC4: Given the tool is called, When the server accepts the event, Then a confirmation message is returned — success response includes `Event logged: ...` confirmation text.

## Story 5.4: Implement `agentlens_session_end` Tool
- [PASS] AC1: Given `agentlens_session_end` is called with `{ sessionId, reason: "completed" }`, When processed, Then a `session_ended` event is sent with the reason — handler sends `eventType: 'session_ended'` and payload contains `reason`.
- [PASS] AC2: Given an optional `summary` field, When provided, Then it is included in the session end event — handler includes `summary` in payload.
- [PASS] AC3: Given valid reasons: `completed`, `error`, `timeout`, `manual`, When any is provided, Then it is accepted — schema uses exact enum of these values.
- [PASS] AC4: Given the tool is called, When processed, Then the session status is updated on the server — MCP side sends the canonical `session_ended` event expected by server-side status update flow.

## Story 5.5: Implement `agentlens_query_events` Tool
- [PASS] AC1: Given `agentlens_query_events` is called with `{ sessionId }`, When processed, Then recent events for that session are returned — handler queries `/api/events` with `sessionId` and returns result summaries.
- [FAIL] AC2: Given a `limit` parameter, When provided, Then at most that many events are returned (default 50) — code forwards `limit` (or default 50) to API but does not enforce max count in returned output if API over-returns.
- [FAIL] AC3: Given an `eventType` filter, When provided, Then only matching events are returned — code forwards `eventType` to API but does not apply local filtering before formatting output.
- [FAIL] AC4: Given the query results, When returned to the agent, Then they include event summaries (type, name, timestamp, severity) — summary format includes timestamp/type/severity/payload preview, but no explicit event `name` field.

## Story 5.6: Implement HTTP Transport Layer for MCP→Server Communication
- [PASS] AC1: Given the MCP server sends events, When the server is reachable, Then events are delivered via HTTP POST with API key auth — transport POSTs to API and includes `Authorization: Bearer ...` when key exists.
- [FAIL] AC2: Given the server is unreachable, When events are generated, Then they are buffered in memory (up to 10K events or 10MB) — buffering exists in `sendEvents`, but tool handlers use `sendEventImmediate`; unreachable tool events return errors instead of being buffered.
- [FAIL] AC3: Given the server becomes reachable again, When reconnected, Then buffered events are flushed in order — transport preserves order during flush, but there is no reconnection-triggered automatic flush mechanism.
- [PASS] AC4: Given the MCP server shuts down (SIGTERM/SIGINT), When shutdown is triggered, Then remaining buffered events are flushed before exit — shutdown handlers await `flush()` before `process.exit(0)`.

## Summary: 19 PASS / 5 FAIL
