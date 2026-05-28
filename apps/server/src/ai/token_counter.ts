import { createRequire } from 'node:module';

const safeRequire = createRequire(import.meta.url);

export interface TokenCounter {
  countTokens(text: string, provider: string, model: string): number;
  countMessagesTokens(messages: { role: string; parts: { type: string; text?: string; json?: Record<string, unknown> }[] }[], provider: string, model: string): number;
}

const MESSAGE_FORMAT_OVERHEAD = 4;
const CHARS_PER_TOKEN_ANTHROPIC = 3.5;
const CHARS_PER_TOKEN_FALLBACK = 4;

const MODEL_TO_ENCODING: Record<string, string> = {
  'gpt-4.1': 'o200k_base',
  'gpt-4.1-mini': 'o200k_base',
  'gpt-4.1-nano': 'o200k_base',
  'gpt-4o': 'o200k_base',
  'gpt-4o-mini': 'o200k_base',
  'gpt-4-turbo': 'cl100k_base',
  'gpt-4': 'cl100k_base',
  'gpt-3.5-turbo': 'cl100k_base',
  'deepseek-chat': 'cl100k_base',
  'deepseek-reasoner': 'cl100k_base',
  'text-embedding-3-small': 'cl100k_base',
  'text-embedding-3-large': 'cl100k_base',
};

const resolveEncodingName = (model: string): string | null => {
  if (MODEL_TO_ENCODING[model]) return MODEL_TO_ENCODING[model];
  for (const [prefix, encoding] of Object.entries(MODEL_TO_ENCODING)) {
    if (model.startsWith(prefix)) return encoding;
  }
  return null;
};

const isOpenAiCompatible = (provider: string): boolean => {
  return provider === 'openai' || provider === 'deepseek' || provider === 'ollama';
};


export const createTokenCounter = (): TokenCounter => {
  const encodingCache = new Map<string, { encode(text: string): { length: number } }>();

  const ensureEncoding = (encodingName: string): { encode(text: string): { length: number } } | null => {
    const cached = encodingCache.get(encodingName);
    if (cached) return cached;

    let tiktokenModule: unknown = null;
    try {
      tiktokenModule = safeRequire('tiktoken');
    } catch {
      // tiktoken not available
    }
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- boundary type assertion
    const tiktoken = tiktokenModule as {
      get_encoding(name: string): { encode(text: string): { length: number } };
    } | null;

    if (!tiktoken?.get_encoding) return null;

    try {
      const enc = tiktoken.get_encoding(encodingName);
      if (enc) {
        encodingCache.set(encodingName, enc);
        return enc;
      }
    } catch {
      // encoding 不存在
    }

    return null;
  };

  return {
    countTokens(text, provider, model) {
      if (typeof text !== 'string' || text.length === 0) return 0;

      if (isOpenAiCompatible(provider)) {
        const encodingName = resolveEncodingName(model);
        if (encodingName) {
          const enc = ensureEncoding(encodingName);
          if (enc) return enc.encode(text).length;
        }
      }

      if (provider === 'anthropic') {
        return Math.ceil(text.length / CHARS_PER_TOKEN_ANTHROPIC);
      }

      return Math.ceil(text.length / CHARS_PER_TOKEN_FALLBACK);
    },

    countMessagesTokens(messages, provider, model) {
      let total = 0;

      for (const msg of messages) {
        total += MESSAGE_FORMAT_OVERHEAD;
        for (const part of msg.parts) {
          if (part.type === 'text' && typeof part.text === 'string') {
            total += this.countTokens(part.text, provider, model);
          } else if (part.type === 'json' && part.json) {
            total += this.countTokens(JSON.stringify(part.json), provider, model);
          }
        }
      }
      return total;
    }
  };
};
