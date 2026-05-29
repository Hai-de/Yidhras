import { describe, expect, it } from 'vitest';

import { createTokenCounter } from '../../../src/ai/token_counter.js';

describe('createTokenCounter', () => {
  const counter = createTokenCounter();

  describe('countTokens', () => {
    it('returns 0 for empty string', () => {
      expect(counter.countTokens('', 'openai', 'gpt-4o')).toBe(0);
    });

    it('returns 0 for non-string input', () => {
      expect(counter.countTokens(undefined as any, 'openai', 'gpt-4o')).toBe(0);
    });

    it('uses anthropic char-based estimation for anthropic provider', () => {
      const text = 'hello world this is a test';
      const result = counter.countTokens(text, 'anthropic', 'claude-3-opus');
      expect(result).toBe(Math.ceil(text.length / 3.5));
    });

    it('uses fallback char-based estimation for unknown provider', () => {
      const text = 'hello world this is a test';
      const result = counter.countTokens(text, 'unknown-provider', 'model-x');
      expect(result).toBe(Math.ceil(text.length / 4));
    });

    it('uses fallback for ollama provider when tiktoken unavailable', () => {
      const text = 'hello';
      const result = counter.countTokens(text, 'ollama', 'llama3');
      expect(result).toBeGreaterThan(0);
    });
  });

  describe('countMessagesTokens', () => {
    it('counts tokens across multiple messages', () => {
      const messages = [
        { role: 'user', parts: [{ type: 'text' as const, text: 'hello' }] },
        { role: 'assistant', parts: [{ type: 'text' as const, text: 'world' }] }
      ];
      const result = counter.countMessagesTokens(messages, 'anthropic', 'claude-3');
      // Each message has format overhead of 4
      // 'hello' → ceil(5/3.5) = 2, 'world' → ceil(5/3.5) = 2
      // Total = 4 + 2 + 4 + 2 = 12
      expect(result).toBe(12);
    });

    it('counts json part tokens', () => {
      const messages = [
        { role: 'user', parts: [{ type: 'json' as const, json: { key: 'value' } }] }
      ];
      const result = counter.countMessagesTokens(messages, 'anthropic', 'claude-3');
      const jsonStr = JSON.stringify({ key: 'value' });
      const expected = 4 + Math.ceil(jsonStr.length / 3.5);
      expect(result).toBe(expected);
    });

    it('returns 0 for empty messages array', () => {
      expect(counter.countMessagesTokens([], 'anthropic', 'claude-3')).toBe(0);
    });

    it('handles messages with multiple parts', () => {
      const messages = [
        {
          role: 'user',
          parts: [
            { type: 'text' as const, text: 'hello' },
            { type: 'json' as const, json: { a: 1 } }
          ]
        }
      ];
      const result = counter.countMessagesTokens(messages, 'anthropic', 'claude-3');
      expect(result).toBeGreaterThan(4); // at least format overhead
    });

    it('skips parts without text or json', () => {
      const messages = [
        { role: 'user', parts: [{ type: 'image' as const }] }
      ];
      const result = counter.countMessagesTokens(messages, 'anthropic', 'claude-3');
      expect(result).toBe(4); // only format overhead
    });
  });
});
