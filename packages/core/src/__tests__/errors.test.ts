import { describe, it, expect } from 'vitest';
import { getErrorMessage } from '../errors.js';

describe('getErrorMessage', () => {
  it('returns message from Error instance', () => {
    expect(getErrorMessage(new Error('boom'))).toBe('boom');
  });

  it('returns message from TypeError instance', () => {
    expect(getErrorMessage(new TypeError('type boom'))).toBe('type boom');
  });

  it('returns string as-is', () => {
    expect(getErrorMessage('something failed')).toBe('something failed');
  });

  it('returns Unknown error for number', () => {
    expect(getErrorMessage(42)).toBe('Unknown error');
  });

  it('returns Unknown error for null', () => {
    expect(getErrorMessage(null)).toBe('Unknown error');
  });

  it('returns Unknown error for undefined', () => {
    expect(getErrorMessage(undefined)).toBe('Unknown error');
  });

  it('returns Unknown error for object with message property', () => {
    expect(getErrorMessage({ message: 'not an error' })).toBe('Unknown error');
  });
});
