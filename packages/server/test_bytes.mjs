import protobuf from 'protobufjs';

// Create a simple proto schema with a bytes field
const root = protobuf.Root.fromJSON({
  nested: {
    test: {
      nested: {
        TestMsg: {
          fields: {
            id: { type: 'bytes', id: 1 }
          }
        }
      }
    }
  }
});

const TestMsg = root.lookupType('test.TestMsg');

// Test: encode and decode with bytes: String
const msg = TestMsg.create({ id: Buffer.from([0xAB, 0xCD, 0xEF]) });
const encoded = TestMsg.encode(msg).finish();
console.log('Encoded bytes (hex):', encoded.toString('hex'));

const decoded = TestMsg.toObject(TestMsg.decode(encoded), {
  bytes: String,
});
console.log('Decoded with bytes:String:', decoded.id);
console.log('Expected base64:', Buffer.from([0xAB, 0xCD, 0xEF]).toString('base64'));
console.log('Match:', decoded.id === Buffer.from([0xAB, 0xCD, 0xEF]).toString('base64'));

// Also test without bytes option (returns Buffer/Uint8Array)
const decodedDefault = TestMsg.toObject(TestMsg.decode(encoded));
console.log('Decoded default (Uint8Array):', decodedDefault.id);
