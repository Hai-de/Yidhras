import { SimulationManager } from '../../core/simulation.js';
import { TOKENS } from '../tokens.js';

export const simulationManagerProvider = {
  provide: TOKENS.sim,
  deps: [TOKENS.prisma, TOKENS.packStorageAdapter] as const,
  useFactory: (deps) => new SimulationManager({
    prisma: deps.prisma,
    packStorageAdapter: deps.packStorageAdapter
  })
} as const satisfies import('../provider.js').ServiceProvider;
