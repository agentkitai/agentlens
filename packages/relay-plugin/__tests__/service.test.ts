import { describe, it, expect } from 'vitest';
import { extractPromptPreview } from '../service.js';

describe('Relay Plugin Service', () => {
  describe('extractPromptPreview', () => {
    it('extracts last user message content', () => {
      const messages = [
        { role: 'system', content: 'You are a helper' },
        { role: 'user', content: 'Hello world' },
        { role: 'assistant', content: 'Hi there' },
        { role: 'user', content: 'What is 2+2?' },
      ];
      expect(extractPromptPreview(messages)).toBe('What is 2+2?');
    });

    it('handles array content blocks', () => {
      const messages = [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Look at this' },
            { type: 'image', data: 'base64...' },
            { type: 'text', text: 'and tell me' },
          ],
        },
      ];
      expect(extractPromptPreview(messages)).toBe('Look at this and tell me');
    });

    it('returns empty for non-array input', () => {
      expect(extractPromptPreview(null as any)).toBe('');
      expect(extractPromptPreview(undefined as any)).toBe('');
    });

    it('returns empty when no user messages', () => {
      const messages = [
        { role: 'system', content: 'system prompt' },
        { role: 'assistant', content: 'hi' },
      ];
      expect(extractPromptPreview(messages)).toBe('');
    });

    it('truncates to 500 chars', () => {
      const longContent = 'a'.repeat(1000);
      const messages = [{ role: 'user', content: longContent }];
      expect(extractPromptPreview(messages).length).toBe(500);
    });
  });
});
