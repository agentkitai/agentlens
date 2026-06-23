/**
 * Guards the vendored OTLP protobuf descriptor (#52). Runs in CI with no network:
 * it rebuilds the descriptor from the vendored .proto files and asserts the
 * committed otlp-proto-descriptor.ts matches — so a stale/hand-edited descriptor,
 * or a .proto change without regeneration, fails the build instead of silently
 * shipping a wrong schema.
 */
import { describe, it, expect } from 'vitest';
import protobuf from 'protobufjs';
import { buildOtlpDescriptor } from '../../scripts/otlp-descriptor-lib.mjs';
import { OTLP_PROTO_DESCRIPTOR } from '../otlp/otlp-proto-descriptor.js';

describe('OTLP proto descriptor', () => {
  it('matches a fresh build from the vendored .proto (run scripts/gen-otlp-descriptor.mjs if this fails)', () => {
    expect(buildOtlpDescriptor()).toEqual(OTLP_PROTO_DESCRIPTOR);
  });

  it('resolves the three collector request types the receiver decodes', () => {
    const root = protobuf.Root.fromJSON(OTLP_PROTO_DESCRIPTOR);
    for (const t of [
      'opentelemetry.proto.collector.trace.v1.ExportTraceServiceRequest',
      'opentelemetry.proto.collector.metrics.v1.ExportMetricsServiceRequest',
      'opentelemetry.proto.collector.logs.v1.ExportLogsServiceRequest',
    ]) {
      expect(root.lookupType(t)).toBeTruthy();
    }
  });
});
