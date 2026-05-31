import type {
  BuildContextRunInput,
  ContextServiceBuildResult
} from './service_types.js';

export interface ContextAssemblyPort {
  buildPromptVariableContext?(input: unknown): unknown;
  buildRuntimeContext?(input: unknown): unknown;
  buildPackScopedContext?(input: unknown): unknown;
  buildContextRun?(input: BuildContextRunInput): Promise<ContextServiceBuildResult>;
}

export interface MemoryRuntimePort {
  queryOverlayEntries?(input: unknown): unknown;
  listMemoryBlocks?(input: unknown): unknown;
  getMemoryRuntimeSnapshot?(input: unknown): unknown;
  buildMemoryContext?(input: import('../memory/service.js').BuildMemoryContextInput): Promise<
    Awaited<ReturnType<import('../memory/service.js').MemoryService['buildMemoryContext']>>
  >;
}
