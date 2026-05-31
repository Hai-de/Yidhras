import type {
  BuildContextRunInput,
  ContextServiceBuildResult} from './service.js';
import type { BuildMemoryContextInput, MemoryService } from '../memory/service.js';

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
  buildMemoryContext?(input: BuildMemoryContextInput): Promise<Awaited<ReturnType<MemoryService['buildMemoryContext']>>>;
}
