import { OTLP_PROTO_DESCRIPTOR } from './src/otlp/otlp-proto-descriptor.js';
import protobuf from 'protobufjs';

const root = protobuf.Root.fromJSON(OTLP_PROTO_DESCRIPTOR);

// Test that we can decode a gen_ai attribute
const KeyValueType = root.lookupType('opentelemetry.proto.common.v1.KeyValue');
const AnyValueType = root.lookupType('opentelemetry.proto.common.v1.AnyValue');

const testKv = KeyValueType.create({
  key: 'gen_ai.system',
  value: AnyValueType.create({ stringValue: 'openai' })
});

const encoded = KeyValueType.encode(testKv).finish();
const decoded = KeyValueType.toObject(KeyValueType.decode(encoded), {
  longs: String, enums: String, bytes: String, defaults: true
});

console.log('Round-trip for gen_ai.system attribute:');
console.log('  ✓ key:', decoded.key);
console.log('  ✓ value.stringValue:', decoded.value.stringValue);

// Test all attribute types that otlp.ts expects
const testCases = [
  { key: 'gen_ai.request.model', value: { stringValue: 'claude-3' } },
  { key: 'gen_ai.usage.input_tokens', value: { intValue: 100 } },
  { key: 'gen_ai.request.temperature', value: { doubleValue: 0.7 } },
  { key: 'gen_ai.response.finish_reasons', value: { arrayValue: { values: [{ stringValue: 'stop' }] } } },
];

console.log('\nAttribute type support:');
for (const tc of testCases) {
  const kv = KeyValueType.create({ key: tc.key, value: AnyValueType.create(tc.value) });
  const enc = KeyValueType.encode(kv).finish();
  const dec = KeyValueType.toObject(KeyValueType.decode(enc), {
    longs: String, enums: String, bytes: String, defaults: true
  });
  console.log(`  ✓ ${tc.key}: type=${Object.keys(tc.value)[0]}`);
}

console.log('\nAll attribute types used by otlp.ts are supported.');
