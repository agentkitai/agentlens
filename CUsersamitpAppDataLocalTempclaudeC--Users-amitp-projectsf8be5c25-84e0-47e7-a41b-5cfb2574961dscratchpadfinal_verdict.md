# PR-B Verification Report: Cache-Aware Cost + Per-Version Savings

## Finding Summary
**Title:** SQL query GROUP BY consistency between main and savings queries
**File:** packages/server/src/db/prompt-store.ts lines 434 & 481
**Severity:** Medium (as stated by reviewer)

## Detailed Analysis

### 1. GROUP BY Mismatch Check
**Is it real?** YES, INTENTIONAL

Main query (line 434):
```sql
GROUP BY pv.id, pv.version_number
```

Savings query (line 481):
```sql
GROUP BY pv.id, model
```

**Evidence of Intentionality:**
- Explicit comment (lines 438-439): "Cache savings need a per-model rate, so aggregate cache-read tokens grouped by (version, model)"
- Different aggregation strategy: main query sums all tokens per version; savings query aggregates per-model to apply correct rates

**Design Rationale:**
- Main query needs total cache tokens for the version (independent of model)
- Savings query needs per-model aggregation because cache savings depend on model-specific rates
- JavaScript aggregation (line 490) sums savings across all models: `byVersion.set(version_id, total + saved)`

### 2. Query Correctness Verification

**Join Condition Identity Check:**
Both queries use IDENTICAL JOIN conditions (lines 424-432 vs 471-479):
- Same FROM/LEFT JOIN structure
- Same filters on promptVersionId, event_type, tenant_id, timestamp
- Same call pairing on callId
✓ PASS: Both queries process the same underlying data

**Functional Logic Verification:**
Single-model test (current, passes):
- Version with 1 call to claude-haiku-4-5, 1M cache reads
- totalCacheReadTokens = 1M ✓
- estimatedCacheSavingsUsd = 1M × (0.8 - 0.08) / 1e6 = 0.72 ✓

Multi-model scenario (hypothetical, NOT tested):
- Version with 2 calls:
  - Call 1: claude-haiku-4-5, 1M cache reads → savings 0.72 USD
  - Call 2: claude-opus-4, 500K cache reads → savings 6.75 USD
- totalCacheReadTokens = 1.5M (correctly aggregated by main query)
- estimatedCacheSavingsUsd = 0.72 + 6.75 = 7.47 USD (correctly aggregated in JS)

**Expected behavior:** CORRECT by design

### 3. Edge Cases & Potential Issues

**Issue 1: NULL model handling**
```javascript
// Line 486
if (!row.model || !row.cache_read) continue;
```

If llm_response has no `$.model` field (malformed data):
- Main query: tokens included in total_cache_read_tokens
- Savings query: row skipped silently
- Impact: Claimed savings < true savings for unknown-model cache reads

**Likelihood:** LOW (well-formed Anthropic/OTLP responses always include model)
**Severity if occurs:** MEDIUM (underestimated savings, not incorrect cost)

**Issue 2: Missing inline documentation**
- The GROUP BY difference is explained in a comment (lines 438-439) but not inline
- Future maintainers might assume it's a bug without reading the context
- No test explicitly validates multi-model scenario

**Likelihood:** HIGH (documentation/test gap)
**Severity:** LOW (design is sound, just needs clarity)

**Issue 3: Missing test coverage**
Current test only covers single-model scenario.
Missing test would:
1. Verify GROUP BY difference produces correct results
2. Verify per-model savings aggregation
3. Confirm join conditions don't drop rows inadvertently

### 4. Cost Formula Verification

**Cache rate derivation (models.ts 71-73):**
```
cacheRead = 0.1 × input
cacheWrite = 1.25 × input
```
✓ Matches relay-plugin reference

**costUsdDetailed formula (lines 152-157):**
```
cost = (input×input_rate + output×output_rate + cache_read×cache_read_rate + cache_write×cache_write_rate) / 1e6
```
✓ Correctly adds cache tokens ADDITIVELY

**Savings formula (lines 158-159):**
```
savings = cache_read_tokens × (input_rate - cache_read_rate) / 1e6 (if cache_read_rate known, else 0)
```
✓ Correctly computes what reads would have cost minus what they actually cost

**Uncached input assumption (line 126-127):**
```
inputTokens: uncached input tokens (provider convention: excludes cache read/creation)
```
✓ Correctly documents that inputTokens from Anthropic API excludes cache tokens
✓ OTLP extraction (lines 514-522) correctly separates input_tokens from cache_*_tokens

### 5. Runtime Behavior Check

**Tests passing:** YES
- 24 prompt-store tests pass (including new cache test)
- 13 pricing tests pass (including new costUsdDetailed tests)
- No regression in existing costs

## Final Verdict

**Is this a REAL bug?**
NO. The design is fundamentally sound.

**Is this a REAL ISSUE?**
YES, but LIMITED:
1. The GROUP BY mismatch is intentional but lacks inline documentation
2. The current test coverage is incomplete (no multi-model test)
3. Edge case vulnerability exists for NULL model (low likelihood, low impact)

**Recommended fixes:**
1. Add inline comment in cacheSavingsByVersion explaining why GROUP BY is (version, model)
2. Add test case with 3+ models in one version, verify totals match
3. Consider logging or asserting when model is NULL/missing

**Risk assessment:** LOW
- Core logic is correct
- Tests verify main path
- Edge cases unlikely in practice
- No double-charging or incorrect math demonstrated

## Reviewer Finding Assessment
**Reviewer claim:** "GROUP BY consistency between main and savings queries...intentional but not documented...missing test"

**Verdict:** ACCURATE
- The mismatch IS intentional ✓
- It IS not documented inline ✓
- Missing test IS a gap ✓
- But this is documentation/test coverage, not a functional bug
