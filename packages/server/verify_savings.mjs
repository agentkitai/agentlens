// Test case from prompt-store.test.ts line 255-274
// claude-haiku-4-5: input 0.8, cacheRead 0.08 (= 0.1 × 0.8), cacheWrite 1.0 (= 1.25 × 0.8)
// cacheReadTokens: 1_000_000, cacheWriteTokens: 200_000

const input = 0.8;
const cacheRead = 0.08; // 0.1 × 0.8
const cacheWrite = 1.0;  // 1.25 × 0.8

const cacheReadTokens = 1_000_000;
const cacheWriteTokens = 200_000;

// From models.ts line 159: cacheSavingsUsd = (cr * (rate.input - rate.cacheRead)) / 1_000_000
const cacheSavingsUsd = (cacheReadTokens * (input - cacheRead)) / 1_000_000;

console.log("Test case verification:");
console.log(`Input rate: ${input}, Cache read rate: ${cacheRead}, Cache write rate: ${cacheWrite}`);
console.log(`Cache read tokens: ${cacheReadTokens}, Cache write tokens: ${cacheWriteTokens}`);
console.log(`Savings = ${cacheReadTokens} × (${input} - ${cacheRead}) / 1e6`);
console.log(`Savings = ${cacheReadTokens} × ${input - cacheRead} / 1e6`);
console.log(`Savings = ${cacheReadTokens * (input - cacheRead)} / 1e6`);
console.log(`Savings = ${cacheSavingsUsd}`);
console.log(`Expected: 0.72`);
console.log(`Match: ${Math.abs(cacheSavingsUsd - 0.72) < 0.000001}`);
