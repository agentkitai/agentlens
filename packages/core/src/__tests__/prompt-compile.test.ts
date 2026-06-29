/**
 * Prompt runtime primitives (#145): variable extraction + compilation (text/chat),
 * defaults, missing-var detection, and config passthrough.
 */
import { describe, it, expect } from 'vitest';
import { extractVariables, compileText, compileChat, compilePrompt } from '../prompt-compile.js';

describe('extractVariables', () => {
  it('finds distinct names with or without whitespace', () => {
    expect(extractVariables('Hi {{name}}, you are {{ role }}. {{name}} again.')).toEqual(['name', 'role']);
    expect(extractVariables('no vars here')).toEqual([]);
  });
});

describe('compileText', () => {
  it('substitutes provided values', () => {
    expect(compileText('Hi {{name}}!', { name: 'Ada' }).text).toBe('Hi Ada!');
  });

  it('applies declared defaults and reports unresolved variables', () => {
    const r = compileText('{{greeting}} {{name}}', { name: 'Ada' }, [{ name: 'greeting', defaultValue: 'Hello' }]);
    expect(r.text).toBe('Hello Ada');
    expect(r.missing).toEqual([]);
  });

  it('leaves an unresolved variable as a literal and flags it', () => {
    const r = compileText('Hi {{name}} from {{org}}', { name: 'Ada' });
    expect(r.text).toBe('Hi Ada from {{org}}');
    expect(r.missing).toEqual(['org']);
  });

  it('coerces non-string values', () => {
    expect(compileText('n={{n}} ok={{ok}}', { n: 42, ok: true }).text).toBe('n=42 ok=true');
  });
});

describe('compileChat', () => {
  it('substitutes variables in every message', () => {
    const r = compileChat(
      [
        { role: 'system', content: 'You are {{persona}}.' },
        { role: 'user', content: 'Help with {{task}}.' },
      ],
      { persona: 'a tutor', task: 'algebra' },
    );
    expect(r.messages).toEqual([
      { role: 'system', content: 'You are a tutor.' },
      { role: 'user', content: 'Help with algebra.' },
    ]);
    expect(r.missing).toEqual([]);
  });
});

describe('compilePrompt', () => {
  it('compiles a text prompt to a ready-to-send request with config', () => {
    const out = compilePrompt(
      { type: 'text', content: 'Summarize: {{doc}}', config: { model: 'gpt-4o', temperature: 0.2 } },
      { doc: 'hello world' },
    );
    expect(out).toMatchObject({ type: 'text', text: 'Summarize: hello world', config: { model: 'gpt-4o', temperature: 0.2 }, missing: [] });
    expect(out.messages).toBeUndefined();
  });

  it('compiles a chat prompt (content as JSON string) and infers type', () => {
    const content = JSON.stringify([{ role: 'user', content: 'Hi {{name}}' }]);
    const out = compilePrompt({ type: 'chat', content }, { name: 'Ada' });
    expect(out.type).toBe('chat');
    expect(out.messages).toEqual([{ role: 'user', content: 'Hi Ada' }]);
    expect(out.text).toBeUndefined();
  });

  it('infers chat when content is a message array', () => {
    const out = compilePrompt({ content: [{ role: 'user', content: '{{x}}' }] }, { x: 'y' });
    expect(out.type).toBe('chat');
    expect(out.messages?.[0]?.content).toBe('y');
  });
});
