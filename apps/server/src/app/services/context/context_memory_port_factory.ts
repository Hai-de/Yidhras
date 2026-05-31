import type { AppContext } from '../../context.js';
import { createContextService, type PluginRuntimePort } from '../../../context/service.js';
import { createContextOverlayStore } from '../../../context/overlay/store.js';
import { createPrismaLongMemoryBlockStore } from '../../../memory/blocks/store.js';
import { createMemoryService } from '../../../memory/service.js';
import type { ContextAssemblyPort, MemoryRuntimePort } from './context_memory_ports.js';

export const createContextAssemblyPort = (context: AppContext): ContextAssemblyPort => {
  const memoryService = createMemoryService({ context });
  const overlayStore = createContextOverlayStore(context);
  const longMemoryBlockStore = createPrismaLongMemoryBlockStore(context);
  const spatialRuntime = context.getSpatialRuntime?.() ?? undefined;

  const contextService = createContextService({
    context,
    memoryService,
    overlayStore,
    longMemoryBlockStore,
    spatialRuntime,
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- pluginRuntime inline type uses unknown[] to break import cycle
    pluginRuntime: context.pluginRuntime as PluginRuntimePort
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
