 
import { createRuntimeClockProjectionService } from '../../app/runtime/runtime_clock_projection.js';
import { createWorldEngineStepCoordinator } from '../../app/runtime/world_engine_persistence.js';
import type { ServiceProvider } from '../provider.js';
import { TOKENS } from '../tokens.js';

export const runtimeClockProjectionProvider: ServiceProvider = {
  provide: TOKENS.runtimeClockProjection,
  useFactory: () => createRuntimeClockProjectionService()
};

export const worldEngineStepCoordinatorProvider: ServiceProvider = {
  provide: TOKENS.worldEngineStepCoordinator,
  useFactory: () => createWorldEngineStepCoordinator()
};
