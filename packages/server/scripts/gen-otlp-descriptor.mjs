// Regenerates src/otlp/otlp-proto-descriptor.ts from the vendored OTLP .proto
// files (src/otlp/proto). The receiver owns this descriptor instead of reaching
// into @opentelemetry/otlp-transformer (which removed its bundled proto root in
// 0.219 — see #52). No network. Run after updating the vendored .proto:
//   node scripts/gen-otlp-descriptor.mjs

import { writeFileSync } from 'node:fs';
import { descriptorModuleSource, DESCRIPTOR_OUT } from './otlp-descriptor-lib.mjs';

const source = descriptorModuleSource();
writeFileSync(DESCRIPTOR_OUT, source);
console.log(`wrote ${DESCRIPTOR_OUT} (${source.length} chars)`);
