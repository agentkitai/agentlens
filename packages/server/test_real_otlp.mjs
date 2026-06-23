import protobuf from 'protobufjs';
import { OTLP_PROTO_DESCRIPTOR } from './src/otlp/otlp-proto-descriptor.ts';
import { createWriteStream } from 'fs';

const root = protobuf.Root.fromJSON(OTLP_PROTO_DESCRIPTOR);
const ExportTraceServiceRequest = root.lookupType('opentelemetry.proto.collector.trace.v1.ExportTraceServiceRequest');

// Create a realistic OTLP trace payload with real binary trace ID
const realTraceId = Buffer.from([0x4b, 0xf9, 0x2b, 0xb2, 0x1b, 0x1a, 0x41, 0x1a, 0x8d, 0x51, 0x3b, 0x1c, 0x23, 0xd4, 0x61, 0xf5]);
const realSpanId = Buffer.from([0x05, 0xf0, 0x66, 0xd7, 0x11, 0x03, 0x44, 0xe6]);

const payload = {
  resourceSpans: [{
    resource: {
      attributes: [{ key: 'service.name', value: { stringValue: 'test-service' } }],
    },
    scopeSpans: [{
      spans: [{
        traceId: realTraceId,
        spanId: realSpanId,
        name: 'test-operation',
        kind: 0,
        startTimeUnixNano: '1700000000000000000',
        endTimeUnixNano: '1700000001000000000',
        attributes: [
          { key: 'http.method', value: { stringValue: 'GET' } },
        ],
      }],
    }],
  }],
};

// Encode
const encoded = ExportTraceServiceRequest.encode(ExportTraceServiceRequest.create(payload)).finish();
console.log('Encoded protobuf size:', encoded.length, 'bytes');
console.log('Trace ID (binary):', realTraceId.toString('hex'));
console.log('Span ID (binary):', realSpanId.toString('hex'));

// Decode like otlp.ts does
const decoded = ExportTraceServiceRequest.toObject(ExportTraceServiceRequest.decode(encoded), {
  longs: String,
  enums: String,
  bytes: String,
  defaults: true,
});

console.log('\nAfter decode with bytes: String:');
console.log('Trace ID (decoded):', decoded.resourceSpans[0].scopeSpans[0].spans[0].traceId);
console.log('Span ID (decoded):', decoded.resourceSpans[0].scopeSpans[0].spans[0].spanId);

// Verify it's base64
console.log('\nVerification:');
console.log('Trace ID expected base64:', realTraceId.toString('base64'));
console.log('Match:', decoded.resourceSpans[0].scopeSpans[0].spans[0].traceId === realTraceId.toString('base64'));

console.log('Span ID expected base64:', realSpanId.toString('base64'));
console.log('Match:', decoded.resourceSpans[0].scopeSpans[0].spans[0].spanId === realSpanId.toString('base64'));
