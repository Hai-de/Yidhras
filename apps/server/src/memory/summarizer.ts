import type { MemoryEntry } from './types.js';

export interface MemorySummarizer {
  summarize(entries: MemoryEntry[], limit: number): Promise<MemoryEntry[]>;
}

export const createNoopMemorySummarizer = (): MemorySummarizer => {
  return {
    async summarize(_entries: MemoryEntry[], _limit: number): Promise<MemoryEntry[]> {
      return [];
    }
  };
};
