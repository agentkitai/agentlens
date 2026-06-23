import protobuf from 'protobufjs';

// Create the same structure as OTLP Span
const root = protobuf.Root.fromJSON({
  nested: {
    test: {
      nested: {
        Span: {
          fields: {
            traceId: { type: 'bytes', id: 1, protoName: 'trace_id' },
            spanId: { type: 'bytes', id: 2, protoName: 'span_id' },
            name: { type: 'string', id: 3 }
          }
        }
      }
    }
  }
});

const Span = root.lookupType('test.Span');

console.log('=== Test 1: Create with string inputs (like makeTracesPayload) ===');
const payload = {
  name: 'test',
  traceId: 'abc123',
  spanId: 'span0',
};

const encoded = Span.encode(Span.create(payload)).finish();
console.log('Encoded (hex):', encoded.toString('hex'));

// Decode like otlp.ts does
const decoded = Span.toObject(Span.decode(encoded), {
  longs: String,
  enums: String,
  bytes: String,
  defaults: true,
});

console.log('Decoded traceId:', decoded.traceId);
console.log('Decoded spanId:', decoded.spanId);
console.log('Type:', typeof decoded.traceId);

// Check what the raw decode gives us (before toObject)
const decodedRaw = Span.decode(encoded);
console.log('Raw decode traceId type:', decodedRaw.traceId.constructor.name);
console.log('Raw decode traceId:', decodedRaw.traceId);
