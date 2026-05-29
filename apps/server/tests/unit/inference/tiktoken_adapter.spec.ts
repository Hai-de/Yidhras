import { describe, expect, it } from 'vitest';

import { createTiktokenTokenizer, getDefaultTokenizer,TiktokenTokenizerAdapter } from '../../../src/inference/tokenizers/tiktoken_adapter.js';

describe('tiktoken_adapter', () => {
  describe('TiktokenTokenizerAdapter', () => {
    it('exposes encodingName', () => {
      const tokenizer = new TiktokenTokenizerAdapter();
      expect(tokenizer.encodingName).toBe('cl100k_base');
    });

    describe('encode', () => {
      it('returns an array of numbers', () => {
        const tokenizer = new TiktokenTokenizerAdapter();
        const tokens = tokenizer.encode('Hello, world!');
        expect(Array.isArray(tokens)).toBe(true);
        expect(tokens.length).toBeGreaterThan(0);
        for (const t of tokens) {
          expect(typeof t).toBe('number');
        }
      });

      it('returns more tokens for longer text', () => {
        const tokenizer = new TiktokenTokenizerAdapter();
        const short = tokenizer.encode('Hi');
        const long = tokenizer.encode('This is a much longer sentence with many words');
        expect(long.length).toBeGreaterThan(short.length);
      });

      it('returns empty array for empty string', () => {
        const tokenizer = new TiktokenTokenizerAdapter();
        const tokens = tokenizer.encode('');
        expect(tokens).toEqual([]);
      });
    });

    describe('count', () => {
      it('returns token count', () => {
        const tokenizer = new TiktokenTokenizerAdapter();
        const count = tokenizer.count('Hello, world!');
        expect(count).toBeGreaterThan(0);
        expect(typeof count).toBe('number');
      });

      it('matches encode length', () => {
        const tokenizer = new TiktokenTokenizerAdapter();
        const text = 'Test string for counting';
        expect(tokenizer.count(text)).toBe(tokenizer.encode(text).length);
      });

      it('returns 0 for empty string', () => {
        const tokenizer = new TiktokenTokenizerAdapter();
        expect(tokenizer.count('')).toBe(0);
      });
    });

    describe('slice', () => {
      it('returns full text when token limit is higher', () => {
        const tokenizer = new TiktokenTokenizerAdapter();
        const text = 'Short text';
        expect(tokenizer.slice(text, 1000)).toBe(text);
      });

      it('truncates when token limit is lower', () => {
        const tokenizer = new TiktokenTokenizerAdapter();
        const text = 'This is a longer text that should be truncated';
        const result = tokenizer.slice(text, 5);
        expect(result.length).toBeLessThan(text.length);
        expect(result.length).toBeGreaterThan(0);
      });

      it('returns empty string for maxTokens <= 0', () => {
        const tokenizer = new TiktokenTokenizerAdapter();
        expect(tokenizer.slice('Hello', 0)).toBe('');
        expect(tokenizer.slice('Hello', -1)).toBe('');
      });

      it('returns full text when token count equals limit', () => {
        const tokenizer = new TiktokenTokenizerAdapter();
        const text = 'Test';
        const count = tokenizer.count(text);
        expect(tokenizer.slice(text, count)).toBe(text);
      });
    });
  });

  describe('createTiktokenTokenizer', () => {
    it('returns a tokenizer instance', () => {
      const tokenizer = createTiktokenTokenizer();
      expect(tokenizer).toBeDefined();
      expect(typeof tokenizer.encode).toBe('function');
      expect(typeof tokenizer.count).toBe('function');
      expect(typeof tokenizer.slice).toBe('function');
    });
  });

  describe('getDefaultTokenizer', () => {
    it('returns a tokenizer instance', () => {
      const tokenizer = getDefaultTokenizer();
      expect(tokenizer).toBeDefined();
      expect(tokenizer.encodingName).toBe('cl100k_base');
    });

    it('returns same instance on multiple calls', () => {
      const t1 = getDefaultTokenizer();
      const t2 = getDefaultTokenizer();
      expect(t1).toBe(t2);
    });
  });
});
