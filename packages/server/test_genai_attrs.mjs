// Final verification: can we encode/decode a realistic GenAI span with all the attributes
// that otlp.ts mapGenAiSpan expects?
import protobuf from 'protobufjs';
import { OTLP_PROTO_DESCRIPTOR } from './src/otlp/otlp-proto-descriptor.js';

const root = protobuf.Root.fromJSON(OTLP_PROTO_DESCRIPTOR);
const ExportTraceType = root.lookupType('opentelemetry.proto.collector.trace.v1.ExportTraceServiceRequest');

// Build a GenAI span with all possible attributes that otlp.ts mapGenAiSpan reads
const genaiPayload = {
  resourceSpans: [{
    resource: {
      attributes: [
        { key: 'service.name', value: { stringValue: 'my-agent' } },
        { key: 'gen_ai.conversation.id', value: { stringValue: 'conv-123' } },
        { key: 'gen_ai.agent.name', value: { stringValue: 'AgentX' } },
      ]
    },
    scopeSpans: [{
      spans: [{
        name: 'llm_request',
        traceId: '01234567890abcdef',
        spanId: '0102030405060708',
        startTimeUnixNano: '1700000000000000000',
        endTimeUnixNano: '1700000001000000000',
        status: { code: 0 },
        attributes: [
          { key: 'gen_ai.operation.name', value: { stringValue: 'chat' } },
          { key: 'gen_ai.system', value: { stringValue: 'openai' } },
          { key: 'gen_ai.request.model', value: { stringValue: 'gpt-4' } },
          { key: 'gen_ai.response.model', value: { stringValue: 'gpt-4' } },
          { key: 'gen_ai.request.temperature', value: { doubleValue: 0.7 } },
          { key: 'gen_ai.request.max_tokens', value: { intValue: 2000 } },
          { key: 'gen_ai.usage.input_tokens', value: { intValue: 100 } },
          { key: 'gen_ai.usage.output_tokens', value: { intValue: 150 } },
          { key: 'gen_ai.response.finish_reason', value: { stringValue: 'stop' } },
          { key: 'gen_ai.response.finish_reasons', value: {
            arrayValue: { values: [{ stringValue: 'stop' }, { stringValue: 'length' }] }
          }},
          { key: 'gen_ai.prompt.0.role', value: { stringValue: 'user' } },
          { key: 'gen_ai.prompt.0.content', value: { stringValue: 'Hello!' } },
          { key: 'gen_ai.completion.0.role', value: { stringValue: 'assistant' } },
          { key: 'gen_ai.completion.0.content', value: { stringValue: 'Hi there!' } },
          { key: 'gen_ai.input.messages', value: {
            stringValue: JSON.stringify([{ role: 'user', content: 'Hello' }])
          }},
          { key: 'gen_ai.output.messages', value: {
            stringValue: JSON.stringify([{ role: 'assistant', content: 'Hi' }])
          }},
        ]
      }]
    }]
  }]
};

// Encode and decode round-trip
try {
  const msg = ExportTraceType.create(genaiPayload);
  const encoded = ExportTraceType.encode(msg).finish();
  const decoded = ExportTraceType.decode(encoded);
  const obj = ExportTraceType.toObject(decoded, {
    longs: String, enums: String, bytes: String, defaults: true
  });

  // Verify all attributes are present and accessible
  const span = obj.resourceSpans[0].scopeSpans[0].spans[0];
  const attrs = span.attributes || [];

  const checkAttrs = [
    'gen_ai.operation.name', 'gen_ai.system', 'gen_ai.request.model',
    'gen_ai.response.model', 'gen_ai.request.temperature',
    'gen_ai.usage.input_tokens', 'gen_ai.usage.output_tokens',
    'gen_ai.response.finish_reason', 'gen_ai.response.finish_reasons',
  ];

  let all_found = true;
  for (const key of checkAttrs) {
    const found = attrs.some(a => a.key === key);
    if (found) {
      console.log(`  ✓ ${key}`);
    } else {
      console.log(`  ✗ ${key} MISSING`);
      all_found = false;
    }
  }

  if (all_found) {
    console.log('\n✓ GenAI semantic convention attributes fully supported');
    console.log(`✓ Encoded GenAI span: ${encoded.length} bytes`);
  } else {
    console.log('\n✗ Some GenAI attributes missing!');
    process.exit(1);
  }
} catch (err) {
  console.error('ERROR:', err.message);
  process.exit(1);
}
