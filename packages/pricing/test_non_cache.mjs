import { costUsd, costUsdDetailed } from './dist/index.js';

// Test: non-cached call should produce same result via both functions
const model = 'claude-haiku-4-5';
const inputTokens = 100;
const outputTokens = 50;

const old = costUsd(model, inputTokens, outputTokens);
console.log("costUsd (old): ", old);

const detailed = costUsdDetailed(model, { inputTokens, outputTokens });
console.log("costUsdDetailed (no cache): ", detailed);

// They should match
console.log("Match: ", Math.abs(old - detailed.costUsd) < 0.000001);
console.log("Cache savings should be 0: ", detailed.cacheSavingsUsd === 0);

// Manual calculation: (100 * 0.8 + 50 * 4) / 1e6 = (80 + 200) / 1e6 = 280 / 1e6 = 0.00028
console.log("Manual: (100 * 0.8 + 50 * 4) / 1e6 = ", (100 * 0.8 + 50 * 4) / 1_000_000);
