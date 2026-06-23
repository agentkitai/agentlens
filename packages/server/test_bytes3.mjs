import protobuf from 'protobufjs';

// UTF-8 encoding of 'abc123'
const utf8_abc123 = Buffer.from('abc123', 'utf-8');
const base64_utf8 = utf8_abc123.toString('base64');

console.log('String "abc123" as UTF-8 bytes:', utf8_abc123.toString('hex'));
console.log('Same bytes as base64:', base64_utf8);

// So when we create { traceId: 'abc123' }, it gets UTF-8 encoded to bytes,
// then toObject with bytes:String decodes those bytes back to base64.
// The result should be consistent: base64(utf8('abc123')) == 'YWJjMTIz' not 'abc123'
console.log('Expected from test:', Buffer.from('YWJjMTIz', 'base64').toString());
