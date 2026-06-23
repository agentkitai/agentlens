import protobuf from 'protobufjs';
import { OTLP_PROTO_DESCRIPTOR } from './src/otlp/otlp-proto-descriptor.ts';

const root = protobuf.Root.fromJSON(OTLP_PROTO_DESCRIPTOR);
const SpanType = root.lookupType('opentelemetry.proto.trace.v1.Span');

// Debug the actual encoding
const span = SpanType.create({
  name: 'test',
  traceId: 'abc123',
  spanId: 'span0',
  startTimeUnixNano: '1700000000000000000',
  endTimeUnixNano: '1700000001000000000',
});

console.log('Created span object:', span);
console.log('span.traceId type:', typeof span.traceId);
console.log('span.traceId value:', span.traceId);
console.log('Is Buffer?', Buffer.isBuffer(span.traceId));
if (span.traceId && typeof span.traceId === 'object') {
  console.log('toString("hex"):', span.traceId.toString('hex'));
  console.log('toString("base64"):', span.traceId.toString('base64'));
}

const encoded = SpanType.encode(span).finish();
console.log('\nEncoded (hex):', encoded.toString('hex'));

const decoded = SpanType.decode(encoded);
console.log('Raw decode traceId:', decoded.traceId);
console.log('Raw decode traceId type:', typeof decoded.traceId);
if (decoded.traceId) {
  console.log('Raw decode traceId toString("hex"):', decoded.traceId.toString('hex'));
  console.log('Raw decode traceId toString("base64"):', decoded.traceId.toString('base64'));
}

const decodedObj = SpanType.toObject(decoded, {
  longs: String,
  enums: String,
  bytes: String,
  defaults: true,
});
console.log('After toObject with bytes:String:', decodedObj.traceId);
