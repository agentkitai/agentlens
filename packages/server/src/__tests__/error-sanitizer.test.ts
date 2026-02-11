import { describe, it, expect } from 'vitest';
import { sanitizeErrorMessage, getErrorStatus, ClientError } from '../lib/error-sanitizer.js';

describe('error-sanitizer', () => {
  describe('ClientError', () => {
    it('carries statusCode and message', () => {
      const err = new ClientError(404, 'Not found');
      expect(err.statusCode).toBe(404);
      expect(err.message).toBe('Not found');
      expect(err).toBeInstanceOf(Error);
    });

    it('has name ClientError', () => {
      const err = new ClientError(400, 'Bad request');
      expect(err.name).toBe('ClientError');
    });
  });

  describe('sanitizeErrorMessage', () => {
    it('returns client message for ClientError 4xx', () => {
      const err = new ClientError(422, 'Invalid input');
      expect(sanitizeErrorMessage(err)).toBe('Invalid input');
    });

    it('returns generic message for regular Error', () => {
      expect(sanitizeErrorMessage(new Error('SQLITE_CONSTRAINT: UNIQUE'))).toBe('Internal server error');
    });

    it('returns generic message for string error', () => {
      expect(sanitizeErrorMessage('something broke')).toBe('Internal server error');
    });

    it('returns generic message for unknown/null/undefined', () => {
      expect(sanitizeErrorMessage(null)).toBe('Internal server error');
      expect(sanitizeErrorMessage(undefined)).toBe('Internal server error');
      expect(sanitizeErrorMessage(42)).toBe('Internal server error');
    });

    it('never leaks SQLite errors', () => {
      const err = new Error('SQLITE_ERROR: no such table: events');
      expect(sanitizeErrorMessage(err)).toBe('Internal server error');
    });

    it('never leaks file paths', () => {
      const err = new Error('ENOENT: /home/amit/projects/agentlens/data.db');
      expect(sanitizeErrorMessage(err)).toBe('Internal server error');
    });

    it('never leaks stack traces', () => {
      const err = new Error('fail');
      err.stack = 'Error: fail\n    at Object.<anonymous> (/home/amit/foo.ts:10:5)';
      expect(sanitizeErrorMessage(err)).toBe('Internal server error');
    });

    it('treats ClientError with 5xx status as internal', () => {
      const err = new ClientError(500, 'db crashed');
      expect(sanitizeErrorMessage(err)).toBe('Internal server error');
    });
  });

  describe('getErrorStatus', () => {
    it('returns statusCode from ClientError', () => {
      expect(getErrorStatus(new ClientError(404, 'x'))).toBe(404);
    });

    it('returns status from object with status property', () => {
      const err = Object.assign(new Error('x'), { status: 503 });
      expect(getErrorStatus(err)).toBe(503);
    });

    it('defaults to 500 for plain errors', () => {
      expect(getErrorStatus(new Error('x'))).toBe(500);
      expect(getErrorStatus('string')).toBe(500);
      expect(getErrorStatus(null)).toBe(500);
    });
  });
});
