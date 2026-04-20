import type {
  BuildContextRunInput,
  ContextService,
  ContextServiceBuildResult} from '../../context/service.js';
import { createContextService } from '../../context/service.js';
import { createPrismaLongMemoryBlockStore } from '../../memory/blocks/store.js';
import type { BuildMemoryContextInput, MemoryService } from '../../memory/service.js';
import { createMemoryService } from '../../memory/service.js';
import type { AppContext } from '../context.js';

export interface ContextAssemblyPort {
  buildPromptVariableContext?(input: unknown): Promise<unknown> | unknown;
  buildRuntimeContext?(input: unknown): Promise<unknown> | unknown;
  buildPackScopedContext?(input: unknown): Promise<unknown> | unknown;
  buildContextRun?(input: BuildContextRunInput): Promise<ContextServiceBuildResult>;
}

export interface MemoryRuntimePort {
  queryOverlayEntries?(input: unknown): Promise<unknown> | unknown;
  listMemoryBlocks?(input: unknown): Promise<unknown> | unknown;
  getMemoryRuntimeSnapshot?(input: unknown): Promise<unknown> | unknown;
  buildMemoryContext?(input: BuildMemoryContextInput): Promise<Awaited<ReturnType<MemoryService['buildMemoryContext']>>>;
}

export const createContextAssemblyPort = (context: AppContext): ContextAssemblyPort => {
  const contextService: ContextService = createContextService({
    context,
    memoryService: createMemoryService({ context }),
    longMemoryBlockStore: createPrismaLongMemoryBlockStore(context)
  });

  return {
    async buildContextRun(input) {
      return contextService.buildContextRun(input);
    }
  };
};

export const createMemoryRuntimePort = (context: AppContext): MemoryRuntimePort => {
  const memoryService = createMemoryService({ context });

  return {
    async buildMemoryContext(input) {
      return memoryService.buildMemoryContext(input);
    }
  };
};
