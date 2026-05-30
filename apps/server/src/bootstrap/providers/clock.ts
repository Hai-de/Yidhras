import { createRuntimeClockProjectionService } from '../../app/runtime/runtime_clock_projection.js';
import { createWorldEngineStepCoordinator } from '../../app/runtime/world_engine_persistence.js';
import { TOKENS } from '../tokens.js';

export const runtimeClockProjectionProvider = {
  provide: TOKENS.runtimeClockProjection,
  useFactory: () => createRuntimeClockProjectionService()
} as const satisfies import('../provider.js').ServiceProvider;

export const worldEngineStepCoordinatorProvider = {
  provide: TOKENS.worldEngineStepCoordinator,
  useFactory: () => createWorldEngineStepCoordinator()
} as const satisfies import('../provider.js').ServiceProvider;
