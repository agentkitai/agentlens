import protobuf from 'protobufjs';
import { OTLP_PROTO_DESCRIPTOR } from './src/otlp/otlp-proto-descriptor.ts';

const root = protobuf.Root.fromJSON(OTLP_PROTO_DESCRIPTOR);
const SpanType = root.lookupType('opentelemetry.proto.trace.v1.Span');

console.log('=== OTLP Bytes Field Format Verification ===\n');

// Test 1: Binary bytes (like real binary trace IDs)
const binaryTraceId = Buffer.from([0xAB, 0xCD, 0xEF, 0x12, 0x34]);
const span1 = SpanType.create({
  name: 'test',
  traceId: binaryTraceId,
  spanId: Buffer.from([0xFF, 0xEE]),
  startTimeUnixNano: '1700000000000000000',
  endTimeUnixNano: '1700000001000000000',
});

const encoded1 = SpanType.encode(span1).finish();
const decoded1 = SpanType.toObject(SpanType.decode(encoded1), {
  longs: String,
  enums: String,
  bytes: String,
  defaults: true,
});

console.log('Test 1: Binary bytes');
console.log('  Input binary:', binaryTraceId.toString('hex'));
console.log('  Decoded (bytes:String):', decoded1.traceId);
console.log('  Expected base64:', binaryTraceId.toString('base64'));
console.log('  Match:', decoded1.traceId === binaryTraceId.toString('base64'));

// Test 2: String input (like makeTracesPayload)
const span2 = SpanType.create({
  name: 'test',
  traceId: 'abc123',
  spanId: 'span0',
  startTimeUnixNano: '1700000000000000000',
  endTimeUnixNano: '1700000001000000000',
});

const encoded2 = SpanType.encode(span2).finish();
const decoded2 = SpanType.toObject(SpanType.decode(encoded2), {
  longs: String,
  enums: String,
  bytes: String,
  defaults: true,
});

console.log('\nTest 2: String input');
console.log('  Input:', 'abc123');
console.log('  Decoded (bytes:String):', decoded2.traceId);
const utf8Bytes = Buffer.from('abc123', 'utf-8');
console.log('  Expected (base64 of UTF-8):', utf8Bytes.toString('base64'));
console.log('  Match:', decoded2.traceId === utf8Bytes.toString('base64'));

console.log('\nConclusion: bytes: String option converts binary fields to base64 strings.');
console.log('This works for both binary inputs and string inputs (UTF-8 encoded then base64).');
