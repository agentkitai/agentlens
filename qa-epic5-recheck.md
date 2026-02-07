# QA Re-check — Epic 5

## Story 5.1: Implement MCP Server Entrypoint with Stdio Transport
- [PASS] AC1: Logs `AgentLens MCP server running` to stderr after stdio connect in `packages/mcp/src/index.ts`.
- [PASS] AC2: `ListToolsRequest` returns exactly 4 tools; verified by `packages/mcp/src/server.test.ts` and `packages/mcp/src/tools.test.ts`.
- [PASS] AC3: `AGENTLENS_URL` and `AGENTLENS_API_KEY` are read in `createServer()` and passed to `AgentLensTransport`.
- [PASS] AC4: Default URL is `http://localhost:3400` when `AGENTLENS_URL` is unset (`packages/mcp/src/index.ts`).

## Story 5.2: Implement `agentlens_session_start` Tool
- [PASS] AC1: Tool sends `session_started` event to server and returns `{ sessionId }`; covered by `packages/mcp/src/tools.ts` and tests.
- [PASS] AC2: Optional `agentName` and `tags` are included in payload when provided (`packages/mcp/src/tools.ts`).
- [PASS] AC3: Unreachable server path returns meaningful error (`Error starting session: ...`), tested in `packages/mcp/src/tools.test.ts`.
- [PASS] AC4: Tool schema requires `agentId`; `agentName`/`tags` optional (schema + schema test).

## Story 5.3: Implement `agentlens_log_event` Tool
- [PASS] AC1: Event is sent to server via HTTP POST `/api/events` (`packages/mcp/src/tools.ts`, tests).
- [PASS] AC2: `severity` overrides default `info` via `severity ?? 'info'`.
- [PASS] AC3: `metadata` is accepted and forwarded as arbitrary key-value map.
- [PASS] AC4: On accepted event, confirmation string is returned (`Event logged: ...`).

## Story 5.4: Implement `agentlens_session_end` Tool
- [PASS] AC1: Sends `session_ended` event including `reason` in payload.
- [PASS] AC2: Optional `summary` is included in end-event payload when provided.
- [PASS] AC3: Reason enum allows exactly `completed | error | timeout | manual`.
- [PASS] AC4: Session end event is sent to server (status update delegated to server ingestion logic).

## Story 5.5: Implement `agentlens_query_events` Tool
- [PASS] AC1: Query with `{ sessionId }` calls `/api/events` and returns session events.
- [PASS] AC2: `limit` respected and defaults to `50` when omitted.
- [PASS] AC3: `eventType` filter is passed through query params.
- [FAIL] AC4: Returned summaries include timestamp/type/severity, but no explicit event `name` field is included (`packages/mcp/src/tools.ts`).

## Story 5.6: Implement HTTP Transport Layer for MCP→Server Communication
- [PASS] AC1: Transport delivers events via HTTP POST with Bearer API key auth (`packages/mcp/src/transport.ts`, `transport.test.ts`).
- [FAIL] AC2: Buffering exists in `sendEvents`, but MCP tools send via `sendEventImmediate`; unreachable tool sends return errors instead of buffering generated events.
- [FAIL] AC3: Flush preserves order when invoked, but no reconnect-driven automatic flush mechanism is implemented.
- [PASS] AC4: Shutdown handlers (`SIGTERM`/`SIGINT`) call `flush()` before exit in `installShutdownHandlers()`.

## Summary: 21 PASS / 3 FAIL
