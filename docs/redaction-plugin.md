# Writing Custom Redaction Layers

How to extend the AgentLens redaction pipeline with custom layers.

## RedactionLayer Interface

Every redaction layer implements this interface:

```typescript
interface RedactionLayer {
  /** Unique layer name */
  name: RedactionLayerName;

  /** Execution order (lower = earlier). Built-in layers use 10-60. */
  order: number;

  /**
   * Process text and return findings + modified text.
   * Return status 'blocked' to prevent sharing entirely.
   */
  process(
    text: string,
    context: RedactionContext,
  ): Promise<RedactionLayerResult>;
}

interface RedactionContext {
  tenantId: string;
  agentId?: string;
  category?: string;
  denyListPatterns?: string[];
  knownTenantTerms?: string[];
}

interface RedactionLayerResult {
  text: string;          // Modified text (with redactions applied)
  findings: RedactionFinding[];
  status: 'clean' | 'redacted' | 'blocked';
  reason?: string;       // Required when status is 'blocked'
}

interface RedactionFinding {
  layer: string;
  type: string;
  match: string;
  replacement: string;
  position: { start: number; end: number };
}
```

## Example: Custom PII Layer

```typescript
import type { RedactionLayer, RedactionContext } from '@agentlensai/core';

class CustomPhoneRedactionLayer implements RedactionLayer {
  name = 'custom-phone' as any;
  order = 25; // Between PII (20) and URL scrubbing (30)

  async process(text: string, ctx: RedactionContext) {
    const findings = [];
    // Match international phone numbers
    const pattern = /\+\d{1,3}[-.\s]?\(?\d{1,4}\)?[-.\s]?\d{1,4}[-.\s]?\d{1,9}/g;
    let match;
    let result = text;

    while ((match = pattern.exec(text)) !== null) {
      findings.push({
        layer: this.name,
        type: 'phone-international',
        match: match[0],
        replacement: '[REDACTED:phone]',
        position: { start: match.index, end: match.index + match[0].length },
      });
    }

    // Apply replacements (reverse order to preserve positions)
    for (const f of findings.reverse()) {
      result = result.slice(0, f.position.start) + f.replacement + result.slice(f.position.end);
    }

    return {
      text: result,
      findings,
      status: findings.length > 0 ? 'redacted' as const : 'clean' as const,
    };
  }
}
```

## Registering Custom Layers

### At Construction

```typescript
import { RedactionPipeline } from '@agentlensai/server';

const pipeline = new RedactionPipeline(
  { humanReviewEnabled: false },
  [new CustomPhoneRedactionLayer()],  // Custom layers added here
);
```

### At Runtime

```typescript
pipeline.registerCustomLayer(new CustomPhoneRedactionLayer());
```

Layers are automatically sorted by `order`. Multiple custom layers are supported.

## Example: Blocking Layer

A layer that blocks lessons containing specific domain knowledge:

```typescript
class DomainBlockerLayer implements RedactionLayer {
  name = 'domain-blocker' as any;
  order = 45; // Between tenant deident (40) and deny list (50)

  private blockedTerms = ['proprietary-algo', 'internal-codename'];

  async process(text: string, ctx: RedactionContext) {
    for (const term of this.blockedTerms) {
      if (text.toLowerCase().includes(term.toLowerCase())) {
        return {
          text,
          findings: [{
            layer: this.name,
            type: 'domain-block',
            match: term,
            replacement: '',
            position: { start: 0, end: 0 },
          }],
          status: 'blocked' as const,
          reason: `Content contains blocked domain term: ${term}`,
        };
      }
    }

    return { text, findings: [], status: 'clean' as const };
  }
}
```

## Error Handling

Custom layers follow the same **fail-closed** behavior as built-in layers:
- If your layer throws an exception, the lesson is **blocked**
- This prevents any data from leaking due to plugin bugs
- Always handle errors gracefully within your layer

## Order Guidelines

| Range | Use |
|-------|-----|
| 1–9 | Pre-processing (before built-in layers) |
| 10–60 | Built-in layers (do not use) |
| 61–99 | Post-processing (after built-in layers) |
| 25, 35, etc. | Between built-in layers (use with caution) |

## Testing Your Layer

Use the redaction test endpoint to verify without sharing:

```bash
curl -X POST http://localhost:3000/api/community/redaction/test \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"text": "Call +1-555-0123 for support", "tenantId": "test"}'
```
