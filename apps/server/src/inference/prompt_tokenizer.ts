import type { PromptBlock } from './prompt_block.js';
import type { PromptFragmentV2 } from './prompt_fragment_v2.js';
import type { PromptTree } from './prompt_tree.js';
import { walkPromptBlocksAsync } from './prompt_tree.js';
import { getDefaultTokenizer } from './tokenizers/tiktoken_adapter.js';

// ── Tokenizer interface ──

export interface PromptTokenizer {
  readonly encodingName: string;
  encode(text: string): number[];
  count(text: string): number;
  slice(text: string, maxTokens: number): string;
}

// ── Token estimates ──

export interface SlotTokenEstimate {
  total: number;
  by_fragment: Record<string, number>;
}

export interface TokenEstimate {
  total_tokens: number;
  safety_margin: number;
  by_slot: Record<string, SlotTokenEstimate>;
}

export interface PromptTokenCounter {
  estimateTree(tree: PromptTree, safetyMargin?: number): Promise<TokenEstimate>;
}

// ── Aggregation helpers ──

export function aggregateFragmentTokens(fragment: PromptFragmentV2): number {
  let total = 0;
  for (const child of fragment.children) {
    if ('kind' in child) {
      total += (child).estimated_tokens ?? 0;
    } else {
      total += aggregateFragmentTokens(child);
    }
  }
  fragment.estimated_tokens = total;
  return total;
}

export function aggregateTreeTokens(tree: PromptTree): number {
  let total = 0;
  for (const fragments of Object.values(tree.fragments_by_slot)) {
    for (const fragment of fragments) {
      if (fragment.permission_denied) continue;
      total += aggregateFragmentTokens(fragment);
    }
  }
  return total;
}

// ── TokenCounter implementation ──

export function createPromptTokenCounter(tokenizer: PromptTokenizer): PromptTokenCounter {
  return {
    async estimateTree(tree: PromptTree, safetyMargin?: number): Promise<TokenEstimate> {
      const margin = safetyMargin ?? 80;
      const bySlot: Record<string, SlotTokenEstimate> = {};

      for (const [slotId, fragments] of Object.entries(tree.fragments_by_slot)) {
        const byFragment: Record<string, number> = {};
        for (const fragment of fragments) {
          if (fragment.permission_denied) continue;
          let fragTokens = 0;
          // eslint-disable-next-line @typescript-eslint/require-await -- API contract requires Promise<void> return
          await walkPromptBlocksAsync([fragment], async (block: PromptBlock) => {
            const text = block.rendered;
            if (typeof text === 'string' && text.length > 0) {
              const count = tokenizer.count(text);
              block.estimated_tokens = count;
              block.token_encoding = tokenizer.encodingName;
              fragTokens += count;
            } else {
              block.estimated_tokens = 0;
              block.token_encoding = tokenizer.encodingName;
            }
          });
          fragment.estimated_tokens = fragTokens;
          byFragment[fragment.id] = fragTokens;
        }
        const total = Object.values(byFragment).reduce((s, v) => s + v, 0);
// eslint-disable-next-line security/detect-object-injection -- 从内部枚举构造的键
        bySlot[slotId] = { total, by_fragment: byFragment };
      }

      const rawTotal = Object.values(bySlot).reduce((s, v) => s + v.total, 0);
      return {
        total_tokens: rawTotal + margin,
        safety_margin: margin,
        by_slot: bySlot
      };
    }
  };
}

let defaultCounter: PromptTokenCounter | null = null;

export function getDefaultTokenCounter(): PromptTokenCounter {
  if (!defaultCounter) {
    defaultCounter = createPromptTokenCounter(getDefaultTokenizer());
  }
  return defaultCounter;
}
