import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createLogger } from '../logger';

describe('createLogger', () => {
  let stdoutSpy: ReturnType<typeof vi.spyOn>;
  let stderrSpy: ReturnType<typeof vi.spyOn>;
  const origLevel = process.env.LOG_LEVEL;

  beforeEach(() => {
    stdoutSpy = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
    stderrSpy = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
  });

  afterEach(() => {
    stdoutSpy.mockRestore();
    stderrSpy.mockRestore();
    if (origLevel === undefined) delete process.env.LOG_LEVEL;
    else process.env.LOG_LEVEL = origLevel;
  });

  it('returns all 4 log methods', () => {
    const log = createLogger('Test');
    expect(typeof log.debug).toBe('function');
    expect(typeof log.info).toBe('function');
    expect(typeof log.warn).toBe('function');
    expect(typeof log.error).toBe('function');
  });

  it('info outputs correct JSON format', () => {
    const log = createLogger('App');
    log.info('hello');
    const out = JSON.parse((stdoutSpy.mock.calls[0][0] as string).trim());
    expect(out).toMatchObject({ level: 'info', ns: 'App', msg: 'hello' });
    expect(out.ts).toBeDefined();
  });

  it('warn outputs correct JSON format', () => {
    const log = createLogger('App');
    log.warn('careful');
    const out = JSON.parse((stdoutSpy.mock.calls[0][0] as string).trim());
    expect(out).toMatchObject({ level: 'warn', ns: 'App', msg: 'careful' });
  });

  it('error writes to stderr', () => {
    const log = createLogger('App');
    log.error('boom');
    const out = JSON.parse((stderrSpy.mock.calls[0][0] as string).trim());
    expect(out).toMatchObject({ level: 'error', ns: 'App', msg: 'boom' });
  });

  it('filters debug at default log level (info)', () => {
    delete process.env.LOG_LEVEL;
    const log = createLogger('App');
    log.debug('hidden');
    expect(stdoutSpy).not.toHaveBeenCalled();
  });

  it('includes debug when LOG_LEVEL=debug', () => {
    process.env.LOG_LEVEL = 'debug';
    const log = createLogger('App');
    log.debug('visible');
    const out = JSON.parse((stdoutSpy.mock.calls[0][0] as string).trim());
    expect(out).toMatchObject({ level: 'debug', msg: 'visible' });
  });

  it('namespace appears in output', () => {
    const log = createLogger('MyNS');
    log.info('test');
    const out = JSON.parse((stdoutSpy.mock.calls[0][0] as string).trim());
    expect(out.ns).toBe('MyNS');
  });

  it('includes data field when provided', () => {
    const log = createLogger('App');
    log.info('with data', { key: 'val' });
    const out = JSON.parse((stdoutSpy.mock.calls[0][0] as string).trim());
    expect(out.data).toEqual({ key: 'val' });
  });

  it('omits data field when not provided', () => {
    const log = createLogger('App');
    log.info('no data');
    const out = JSON.parse((stdoutSpy.mock.calls[0][0] as string).trim());
    expect(out).not.toHaveProperty('data');
  });
});
