import { EMBEDDED_MODEL_COSTS, lookupModelCost } from './dist/index.js';

console.log("Before test - EMBEDDED_MODEL_COSTS['claude-haiku-4-5']:");
const initial = EMBEDDED_MODEL_COSTS['claude-haiku-4-5'];
console.log(JSON.stringify(initial, null, 2));

// Simulate what setModelCosts does in refreshFromLiteLLM
const merged = { ...EMBEDDED_MODEL_COSTS };
console.log("\nAfter spreading - are they the same object?");
console.log("merged['claude-haiku-4-5'] === initial:", merged['claude-haiku-4-5'] === initial);

// Look it up
const looked = lookupModelCost('claude-haiku-4-5');
console.log("\nAfter lookupModelCost - are cache rates present?");
console.log(JSON.stringify(looked, null, 2));
