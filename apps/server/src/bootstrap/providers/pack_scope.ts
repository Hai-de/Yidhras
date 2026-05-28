/* eslint-disable @typescript-eslint/no-unsafe-type-assertion -- deps cast from ServiceContainer Record<string, unknown> */
import { PackScopeResolver } from '../../app/runtime/PackScopeResolver.js';
import type { SimulationManager } from '../../core/simulation.js';
import type { ServiceProvider } from '../provider.js';
import { TOKENS } from '../tokens.js';

export const packScopeResolverProvider: ServiceProvider = {
  provide: TOKENS.packScope,
  deps: [TOKENS.sim],
  useFactory: (deps) => {
     
    const { sim } = deps as unknown as { sim: SimulationManager };
    return new PackScopeResolver(sim.getPackRuntimeRegistry());
  }
};
