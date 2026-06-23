// Shared build logic for the OTLP protobufjs descriptor, used by BOTH the
// generator script and the drift-guard test, so they can never diverge. Reads
// the VENDORED .proto files (src/otlp/proto) — no network. See #52.

import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import protobuf from 'protobufjs';

const HERE = dirname(fileURLToPath(import.meta.url)); // packages/server/scripts
export const PROTO_TAG = 'v1.3.2'; // opentelemetry-proto pin the vendored .proto came from
export const PROTO_DIR = join(HERE, '..', 'src', 'otlp', 'proto');
export const DESCRIPTOR_OUT = join(HERE, '..', 'src', 'otlp', 'otlp-proto-descriptor.ts');

const ENTRYPOINTS = [
  'opentelemetry/proto/collector/trace/v1/trace_service.proto',
  'opentelemetry/proto/collector/metrics/v1/metrics_service.proto',
  'opentelemetry/proto/collector/logs/v1/logs_service.proto',
];

/** Build the protobufjs JSON descriptor from the vendored .proto files. */
export function buildOtlpDescriptor() {
  const root = new protobuf.Root();
  root.resolvePath = (_origin, target) => join(PROTO_DIR, target);
  root.loadSync(ENTRYPOINTS, { keepCase: false }); // camelCase field names
  return root.toJSON();
}

/** The full TS module source for otlp-proto-descriptor.ts. */
export function descriptorModuleSource() {
  const banner =
    `// GENERATED — do not edit. protobufjs JSON descriptor for the OTLP collector\n` +
    `// service requests, built from the vendored opentelemetry-proto ${PROTO_TAG} .proto\n` +
    `// files in ./proto. Regenerate with:  node scripts/gen-otlp-descriptor.mjs\n` +
    `// (the otlp-descriptor drift test fails if this file and ./proto disagree).\n` +
    `// Owns the OTLP binary decode so the receiver doesn't depend on\n` +
    `// @opentelemetry/otlp-transformer internals (see #52).\n\n` +
    `import type { INamespace } from 'protobufjs';\n\n`;
  // `as unknown as INamespace`: protobufjs toJSON emits `protoName` on some fields,
  // which its own IField type doesn't declare (consumed fine by Root.fromJSON).
  return `${banner}export const OTLP_PROTO_DESCRIPTOR = ${JSON.stringify(buildOtlpDescriptor())} as unknown as INamespace;\n`;
}
