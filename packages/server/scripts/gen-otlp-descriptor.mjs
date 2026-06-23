// Regenerates src/otlp/otlp-proto-descriptor.ts — the protobufjs JSON descriptor
// the OTLP receiver uses to decode incoming binary ExportX­ServiceRequest messages.
//
// We own this instead of reaching into @opentelemetry/otlp-transformer's bundled
// protobuf root (which 0.219 removed — see #52). Run when the OTLP schema needs
// updating:  node scripts/gen-otlp-descriptor.mjs
//
// Requires network (fetches the pinned .proto source) + protobufjs.

import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import protobuf from 'protobufjs';

const TAG = 'v1.3.2'; // opentelemetry-proto release pin
const BASE = `https://raw.githubusercontent.com/open-telemetry/opentelemetry-proto/${TAG}`;

// Transitive closure of the three collector service protos.
const FILES = [
  'opentelemetry/proto/common/v1/common.proto',
  'opentelemetry/proto/resource/v1/resource.proto',
  'opentelemetry/proto/trace/v1/trace.proto',
  'opentelemetry/proto/metrics/v1/metrics.proto',
  'opentelemetry/proto/logs/v1/logs.proto',
  'opentelemetry/proto/collector/trace/v1/trace_service.proto',
  'opentelemetry/proto/collector/metrics/v1/metrics_service.proto',
  'opentelemetry/proto/collector/logs/v1/logs_service.proto',
];
const ENTRYPOINTS = FILES.filter((f) => f.includes('/collector/'));

const dir = mkdtempSync(join(tmpdir(), 'otlp-proto-'));
try {
  for (const f of FILES) {
    const res = await fetch(`${BASE}/${f}`);
    if (!res.ok) throw new Error(`fetch ${f}: HTTP ${res.status}`);
    const dest = join(dir, f);
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, await res.text());
  }

  const root = new protobuf.Root();
  root.resolvePath = (_origin, target) => join(dir, target);
  root.loadSync(ENTRYPOINTS, { keepCase: false });

  const descriptor = root.toJSON();
  const out = join(dirname(new URL(import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, '$1'), '..', 'src', 'otlp', 'otlp-proto-descriptor.ts');
  const banner =
    `// GENERATED — do not edit. protobufjs JSON descriptor for the OTLP collector\n` +
    `// service requests, from opentelemetry-proto ${TAG}. Regenerate with:\n` +
    `//   node scripts/gen-otlp-descriptor.mjs\n` +
    `// Owns the OTLP binary decode so the receiver doesn't depend on\n` +
    `// @opentelemetry/otlp-transformer internals (see #52).\n\n` +
    `import type { INamespace } from 'protobufjs';\n\n`;
  // `as unknown as INamespace`: protobufjs toJSON emits `protoName` on some fields,
  // which its own IField type doesn't declare (consumed fine by Root.fromJSON).
  writeFileSync(out, `${banner}export const OTLP_PROTO_DESCRIPTOR = ${JSON.stringify(descriptor)} as unknown as INamespace;\n`);
  console.log(`wrote ${out} (${JSON.stringify(descriptor).length} chars)`);
} finally {
  rmSync(dir, { recursive: true, force: true });
}
