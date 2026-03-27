import type {
  LongTermMemorySearchInput,
  LongTermMemoryStore,
  MemoryEntry
} from './types.js';

export const createNoopLongTermMemoryStore = (): LongTermMemoryStore => {
  return {
    async search(_input: LongTermMemorySearchInput): Promise<MemoryEntry[]> {
      return [];
    },
    async save(_entries: MemoryEntry[]): Promise<void> {
      return;
    }
  };
};
