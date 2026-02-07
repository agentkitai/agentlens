# QA Report: Epic 2 (Stories 2.1-2.5)

Scope: `_bmad-output/planning-artifacts/epics.md` Epic 2 only.
Code reviewed: `packages/core/src/*`.
Test run: `pnpm --filter @agentlens/core test` -> PASS (`7` files, `96` tests).

## Story 2.1: Define Core Event Types and Interfaces

1. **AC:** `AgentLensEvent` includes `id, timestamp, sessionId, agentId, eventType, severity, payload, metadata, prevHash, hash`  
   **Result:** PASS  
   **Evidence:** `packages/core/src/types.ts:217`

2. **AC:** `EventType` includes all required 16 values  
   **Result:** PASS  
   **Evidence:** `packages/core/src/types.ts:24`

3. **AC:** `EventSeverity` includes `debug, info, warn, error, critical`  
   **Result:** PASS  
   **Evidence:** `packages/core/src/types.ts:74`

4. **AC:** Typed payloads in a discriminated union narrow correctly on `eventType`  
   **Result:** FAIL  
   **Missing:** `AgentLensEvent` is not a discriminated union by `eventType`; it is `{ eventType: EventType; payload: EventPayload }`, so TS does not automatically narrow payload type by `eventType`. Current tests use manual casting (`as ToolCallPayload`) instead of native narrowing.  
   **Evidence:** `packages/core/src/types.ts:217`, `packages/core/src/types.ts:237`

## Story 2.2: Define Session, Agent, and Query Types

1. **AC:** `Session` includes `id, agentId, agentName, startedAt, endedAt, status, eventCount, toolCallCount, errorCount, totalCostUsd, tags`  
   **Result:** PASS  
   **Evidence:** `packages/core/src/types.ts:259`

2. **AC:** `SessionStatus` includes `active, completed, error`  
   **Result:** PASS  
   **Evidence:** `packages/core/src/types.ts:254`

3. **AC:** `EventQuery` supports `sessionId, agentId, eventType, severity, from, to, limit, offset, order, search`  
   **Result:** PASS  
   **Evidence:** `packages/core/src/types.ts:287`

4. **AC:** `SessionQuery` supports `agentId, status, from, to, limit, offset, tags`  
   **Result:** PASS  
   **Evidence:** `packages/core/src/types.ts:308`

5. **AC:** `AlertRule` includes `id, name, enabled, condition, threshold, windowMinutes, scope, notifyChannels`  
   **Result:** PASS  
   **Evidence:** `packages/core/src/types.ts:332`

## Story 2.3: Create Zod Validation Schemas

1. **AC:** `ingestEventSchema` accepts valid event with correctly typed output  
   **Result:** PASS  
   **Evidence:** `packages/core/src/schemas.ts:38`, `packages/core/src/schemas.ts:52`

2. **AC:** Missing `sessionId` returns a descriptive error  
   **Result:** FAIL  
   **Missing:** For a missing field, Zod currently returns generic message `"Required"` (path is `sessionId`), not a custom descriptive message like `"sessionId is required"`.  
   **Evidence:** `packages/core/src/schemas.ts:39`

3. **AC:** `eventTypeSchema` rejects unknown type string  
   **Result:** PASS  
   **Evidence:** `packages/core/src/schemas.ts:11`

4. **AC:** `severitySchema.default('info')` defaults missing severity to `info`  
   **Result:** PASS  
   **Evidence:** `packages/core/src/schemas.ts:33`, `packages/core/src/schemas.ts:42`

5. **AC:** All schemas are re-exported via `index.ts`  
   **Result:** PASS  
   **Evidence:** `packages/core/src/index.ts:12`

## Story 2.4: Implement Hash Chain Utilities

1. **AC:** `computeEventHash()` returns deterministic SHA-256 hex string  
   **Result:** PASS  
   **Evidence:** `packages/core/src/hash.ts:31`, `packages/core/src/hash.ts:41`

2. **AC:** Same input hashed twice gives identical result  
   **Result:** PASS  
   **Evidence:** Deterministic serialization + SHA-256 implementation in `packages/core/src/hash.ts:31`

3. **AC:** `verifyChain()` returns `true` for valid chain  
   **Result:** PASS  
   **Evidence:** `packages/core/src/hash.ts:61`

4. **AC:** If one event payload is modified, `verifyChain()` returns `false`  
   **Result:** FAIL  
   **Missing:** `verifyChain()` only checks `prevHash` linkage between adjacent events; it does not recompute hash from event content/payload, so payload tampering is not directly validated by this function.  
   **Evidence:** `packages/core/src/hash.ts:47`, `packages/core/src/hash.ts:61`

5. **AC:** First event (no predecessor) uses `prevHash = null` and hash computes correctly  
   **Result:** PASS  
   **Evidence:** `computeEventHash` accepts `prevHash: null` (`packages/core/src/hash.ts:19`); event helper defaults first event `prevHash` to `null` (`packages/core/src/events.ts:45`)

## Story 2.5: Implement Event Creation Helpers and Constants

1. **AC:** `createEvent()` with minimal fields returns full `AgentLensEvent` with ULID id, ISO timestamp, default `info` severity, computed hash  
   **Result:** PASS  
   **Evidence:** `packages/core/src/events.ts:40`

2. **AC:** `constants.ts` exports default pagination limit 50, max pagination limit 500, max payload size 10KB, default retention days 90  
   **Result:** PASS  
   **Evidence:** `packages/core/src/constants.ts:6`, `packages/core/src/constants.ts:9`, `packages/core/src/constants.ts:12`, `packages/core/src/constants.ts:15`

3. **AC:** `index.ts` re-exports all public types, schemas, helpers, constants  
   **Result:** PASS  
   **Evidence:** `packages/core/src/index.ts:6`, `packages/core/src/index.ts:12`, `packages/core/src/index.ts:15`, `packages/core/src/index.ts:18`, `packages/core/src/index.ts:21`

## Summary

- Total AC checked: `22`
- PASS: `19`
- FAIL: `3`
- Failed ACs: Story `2.1` #4, Story `2.3` #2, Story `2.4` #4
