import { z } from "zod";

const schema = z.object({
  tenantId: z.string().min(1),
  sessionId: z.string().min(1),
});

console.log("Testing Zod safeParse(null)...\n");

// Test 1: Parse null
try {
  const result1 = schema.safeParse(null);
  console.log("Test 1 - safeParse(null):");
  console.log("  Success:", result1.success);
  if (!result1.success) {
    console.log("  Error issues count:", result1.error.issues.length);
    console.log("  Error thrown?", "No");
  }
} catch (e) {
  console.log("Test 1 CRASHED:", e.message);
}

// Test 2: Accessing error.issues
try {
  const result2 = schema.safeParse(null);
  if (!result2.success) {
    const details = result2.error.issues.map((i) => ({
      path: i.path.map(String).join("."),
      message: i.message
    }));
    console.log("\nTest 2 - Accessing error.issues:");
    console.log("  Details retrieved:", details.length, "items");
    console.log("  Details[0]:", JSON.stringify(details[0]));
  }
} catch (e) {
  console.log("Test 2 CRASHED:", e.message);
}

console.log("\nConclusion: safeParse does NOT throw when passed null");
