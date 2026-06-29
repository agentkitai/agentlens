import { describe, it, expect } from 'vitest';
import { toHexId, spanContextMeta } from '../span-context.js';

describe('toHexId', () => {
  it('passes through hex span/trace ids, lowercasing', () => {
    expect(toHexId('0123456789ABCDEF')).toBe('0123456789abcdef'); // 16-char span id
    expect(toHexId('0123456789abcdef0123456789abcdef')).toBe('0123456789abcdef0123456789abcdef'); // 32-char trace id
  });

  it('decodes protobuf base64 ids to hex (round-trips with JSON hex form)', () => {
    const hexSpan = '0123456789abcdef';
    const b64Span = Buffer.from(hexSpan, 'hex').toString('base64');
    expect(b64Span).not.toBe(hexSpan); // genuinely base64, length 12
    expect(toHexId(b64Span)).toBe(hexSpan);

    const hexTrace = 'abcdef00112233445566778899aabbcc';
    const b64Trace = Buffer.from(hexTrace, 'hex').toString('base64');
    expect(toHexId(b64Trace)).toBe(hexTrace);
  });

  it('treats all-zero / empty ids as no-id (root span has no parent)', () => {
    expect(toHexId('0000000000000000')).toBeUndefined(); // hex all-zero
    expect(toHexId(Buffer.alloc(8).toString('base64'))).toBeUndefined(); // base64 all-zero
    expect(toHexId('')).toBeUndefined();
    expect(toHexId(undefined)).toBeUndefined();
    expect(toHexId(null)).toBeUndefined();
  });
});

describe('spanContextMeta', () => {
  it('stamps normalized ids + timing, omitting an absent parent', () => {
    const meta = spanContextMeta({
      traceId: 'ABCDEF00112233445566778899AABBCC',
      spanId: '0123456789ABCDEF',
      startTimeUnixNano: '1700000000000000000',
      endTimeUnixNano: '1700000000250000000',
    });
    expect(meta).toEqual({
      traceId: 'abcdef00112233445566778899aabbcc',
      spanId: '0123456789abcdef',
      spanStartUnixNano: '1700000000000000000',
      spanEndUnixNano: '1700000000250000000',
      spanDurationMs: 250,
    });
    expect(meta).not.toHaveProperty('parentSpanId');
  });

  it('normalizes a base64 parent (protobuf) so it joins a hex child', () => {
    const parentHex = 'aaaabbbbccccdddd';
    const meta = spanContextMeta({
      spanId: 'feedfacefeedface',
      parentSpanId: Buffer.from(parentHex, 'hex').toString('base64'),
    });
    expect(meta.parentSpanId).toBe(parentHex);
  });
});
