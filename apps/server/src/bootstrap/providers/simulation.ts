/* eslint-disable @typescript-eslint/no-unsafe-type-assertion -- deps cast from ServiceContainer Record<string, unknown> */
import { SimulationManager } from '../../core/simulation.js';
import type { ServiceProvider } from '../provider.js';
import { TOKENS } from '../tokens.js';

export const simulationManagerProvider: ServiceProvider = {
  provide: TOKENS.sim,
  deps: [TOKENS.prisma, TOKENS.packStorageAdapter],
  useFactory: (deps) => {
     
    const { prisma, packStorageAdapter } = deps as unknown as {
      prisma: import('@prisma/client').PrismaClient;
      packStorageAdapter: import('../../packs/storage/PackStorageAdapter.js').PackStorageAdapter;
    };
    return new SimulationManager({ prisma, packStorageAdapter });
  }
};
