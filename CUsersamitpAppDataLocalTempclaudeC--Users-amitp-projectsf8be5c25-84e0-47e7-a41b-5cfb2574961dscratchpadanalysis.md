# SQL Query GROUP BY Consistency Analysis

## The Finding
Main query uses `GROUP BY pv.id, pv.version_number` (line 434)
Savings query uses `GROUP BY pv.id, model` (line 481)

## Is This Real?

### Query Structure Check
Both queries have IDENTICAL join conditions:
- Same FROM/LEFT JOIN structure
- Same filter on `promptVersionId`, `event_type`, `tenant_id`, `timestamp`
- Same call pairing via `callId`

### Intentional vs. Unintentional?
The comment at line 438-439 explicitly states:
"Cache savings need a per-model rate, so aggregate cache-read tokens grouped
by (version, model) and price each group in JS (the main query is per-version)."

This is INTENTIONAL by design.

### Functional Correctness Analysis

**Single-model case (current test):**
- Version has 1 call to claude-haiku-4-5 with 1M cache reads
- Main query: SUM=1M
- Savings query: model=claude-haiku-4-5, cache_read=1M
- Savings calculation: 1M × (0.8 - 0.08) / 1e6 = 0.72 USD ✓

**Multi-model case (missing test):**
- Version has 2 calls: claude-haiku (1M cache reads), claude-opus (500K cache reads)
- Main query: SUM=1.5M total_cache_read_tokens
- Savings query row 1: model=claude-haiku, cache_read=1M
- Savings query row 2: model=claude-opus, cache_read=500K
- Savings aggregation in JS (line 490): 
  - haiku_savings = 0.72
  - opus_savings = 6.75
  - total = 7.47 USD

The logic SHOULD work IF:
1. JOIN produces the same set of responses in both queries ✓ (identical joins)
2. Savings map aggregation sums correctly across models ✓ (byVersion.set uses += pattern)
3. All responses have model field (missing validation)

### Identified Issues

**Issue 1: Missing NULL model validation**
Line 486 skips rows with NULL model:
```javascript
if (!row.model || !row.cache_read) continue;
```

If response has no `$.model` field:
- Main query counts those tokens in total_cache_read_tokens
- Savings query skips them silently
- Result: Claimed savings < actual savings (cache tokens not accounted for)

**Issue 2: No documentation of GROUP BY intentionality**
- Comment exists but not inline
- Future maintainers might assume it's a bug
- Test only covers single-model scenario

**Issue 3: Missing test coverage**
- No multi-model version test
- Doesn't verify GROUP BY difference is intentional
- Doesn't verify per-model savings aggregation

## Verdict
The finding is PARTIALLY CORRECT:
- The GROUP BY difference IS intentional
- The design IS correct for well-formed data
- The implementation HAS a gap: no test for multi-model
- The implementation HAS a subtle issue: NULL model handling
- The code lacks inline documentation of the intentional difference
