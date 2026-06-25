import { EMBEDDED_MODEL_COSTS, setModelCosts, getModelCosts, lookupModelCost } from './dist/index.js';

// Initial state
console.log("1. Initial EMBEDDED_MODEL_COSTS['claude-haiku-4-5']:");
console.log(JSON.stringify(EMBEDDED_MODEL_COSTS['claude-haiku-4-5'], null, 2));

// What refreshFromLiteLLM does: spread EMBEDDED then merge LiteLLM rates
const litellmData = { "claude-haiku-4-5": { input_cost_per_token: 0.0000008, output_cost_per_token: 0.000004 } };
const merged = { 
  ...EMBEDDED_MODEL_COSTS, // shallow copy!
  // mapLiteLlmPrices would create NEW objects here
  "claude-haiku-4-5": { input: 0.8, output: 4.0 } // NEW object, not mutating the original
};

setModelCosts(merged);
console.log("\n2. After setModelCosts with merged table:");
console.log("EMBEDDED_MODEL_COSTS['claude-haiku-4-5']:");
console.log(JSON.stringify(EMBEDDED_MODEL_COSTS['claude-haiku-4-5'], null, 2));
console.log("getModelCosts()['claude-haiku-4-5']:");
console.log(JSON.stringify(getModelCosts()['claude-haiku-4-5'], null, 2));

// The risk: if mapLiteLlmPrices OMITS cache rates, and we use the shallow-copied rate object
// But looking at litellm.ts lines 19-30, mapLiteLlmPrices creates NEW objects with only input/output
// So the shallow copy issue doesn't matter because the new rates don't have cache fields anyway
