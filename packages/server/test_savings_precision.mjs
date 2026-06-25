// Test case from prompt-store.test.ts
// Multiple scenarios to check for precision/accumulation bugs

import { lookupModelCost } from '@agentlensai/core';

// Scenario 1: Single large cache read (test case from line 255-274)
console.log("=== Scenario 1: Single large cache read ===");
const rate1 = lookupModelCost('claude-haiku-4-5');
const cacheRead1 = 1_000_000;
const saved1 = (cacheRead1 * (rate1.input - rate1.cacheRead)) / 1_000_000;
console.log(`Cache read: ${cacheRead1}, Rate: ${rate1.input}, Cache rate: ${rate1.cacheRead}`);
console.log(`Savings: ${saved1}, Expected: 0.72, Match: ${Math.abs(saved1 - 0.72) < 0.000001}`);

// Scenario 2: Multiple models accumulating (byVersion.set accumulation line 490)
console.log("\n=== Scenario 2: Multiple models accumulating savings ===");
const rate2 = lookupModelCost('claude-haiku-4-5');
const rate3 = lookupModelCost('claude-opus-4');

const saved2a = (500_000 * (rate2.input - rate2.cacheRead)) / 1_000_000;
const saved2b = (100_000 * (rate3.input - rate3.cacheRead)) / 1_000_000;
const total2 = saved2a + saved2b;
console.log(`Haiku 500K reads: ${saved2a}`);
console.log(`Opus 100K reads: ${saved2b}`);
console.log(`Total: ${total2}`);

// Scenario 3: Verify rate precision (input 15.0, cache 1.5)
console.log("\n=== Scenario 3: Rate precision for Opus ===");
console.log(`Opus input: ${rate3.input}, Opus cacheRead: ${rate3.cacheRead}`);
console.log(`Diff: ${rate3.input - rate3.cacheRead}`);

// Scenario 4: Model without cache rate (should continue, not contribute)
console.log("\n=== Scenario 4: Model without cache rates (GPT-4o) ===");
const rateGpt = lookupModelCost('gpt-4o');
console.log(`GPT-4o cacheRead: ${rateGpt?.cacheRead}, Should be undefined: ${rateGpt?.cacheRead === undefined}`);
