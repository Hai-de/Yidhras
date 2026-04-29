import { get_encoding, type Tiktoken } from 'tiktoken';

import type { PromptTokenizer } from '../prompt_tokenizer.js';

/**
 * Tiktoken 适配器，基于 cl100k_base 编码（gpt-4 / gpt-4.1-mini / gpt-3.5-turbo 共享）。
 * 后续可新增 HuggingFace tokenizers WASM adapter 实现同一 PromptTokenizer 接口。
 */
export class TiktokenTokenizerAdapter implements PromptTokenizer {
  readonly encodingName = 'cl100k_base';
  private encoder: Tiktoken;

  constructor() {
    this.encoder = get_encoding('cl100k_base');
  }

  encode(text: string): number[] {
    return Array.from(this.encoder.encode(text));
  }

  count(text: string): number {
    return this.encoder.encode(text).length;
  }

  slice(text: string, maxTokens: number): string {
    if (maxTokens <= 0) return '';
    const tokens = this.encoder.encode(text);
    if (tokens.length <= maxTokens) return text;
    const truncated = tokens.slice(0, maxTokens);
    const decoded = this.encoder.decode(truncated);
    if (typeof decoded === 'string') return decoded;
    const uint8 = decoded;
    return new TextDecoder().decode(uint8);
  }
}

let defaultTokenizer: PromptTokenizer | null = null;

export function createTiktokenTokenizer(): PromptTokenizer {
  return new TiktokenTokenizerAdapter();
}

/** 返回默认 tokenizer（当前为 tiktoken cl100k_base），后续可扩展为按 model 选择。 */
export function getDefaultTokenizer(): PromptTokenizer {
  if (!defaultTokenizer) {
    defaultTokenizer = new TiktokenTokenizerAdapter();
  }
  return defaultTokenizer;
}
