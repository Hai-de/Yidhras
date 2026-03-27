import type { AppContext } from '../app/context.js';
import type { InferenceActorRef } from '../inference/types.js';
import { createNoopLongTermMemoryStore } from './long_term_store.js';
import { selectMemory, toMemoryContextPack } from './selector.js';
import { buildShortTermMemory } from './short_term_adapter.js';
import { createNoopMemorySummarizer } from './summarizer.js';
import type { LongTermMemoryStore, MemoryContextPack, MemorySelectionResult } from './types.js';

export interface BuildMemoryContextInput {
  actor_ref: InferenceActorRef;
  resolved_agent_id: string | null;
}

export interface MemoryService {
  buildMemoryContext(input: BuildMemoryContextInput): Promise<{
    selection: MemorySelectionResult;
    context_pack: MemoryContextPack;
  }>;
}

export interface CreateMemoryServiceOptions {
  context: AppContext;
  longTermStore?: LongTermMemoryStore;
}

export const createMemoryService = ({
  context,
  longTermStore = createNoopLongTermMemoryStore()
}: CreateMemoryServiceOptions): MemoryService => {
  return {
    async buildMemoryContext(input) {
      const shortTerm = await buildShortTermMemory(context, {
        actor_ref: input.actor_ref,
        resolved_agent_id: input.resolved_agent_id
      });
      const longTerm = await longTermStore.search({
        actor_ref: input.actor_ref,
        limit: 4
      });
      const summaries = await createNoopMemorySummarizer().summarize(shortTerm, 2);

      const selection = selectMemory({
        short_term: shortTerm,
        long_term: longTerm,
        summaries
      });

      return {
        selection,
        context_pack: toMemoryContextPack(selection)
      };
    }
  };
};
