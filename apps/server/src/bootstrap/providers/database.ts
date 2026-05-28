/* eslint-disable @typescript-eslint/no-unsafe-type-assertion -- deps cast from ServiceContainer Record<string, unknown> */
import type { PrismaClient } from '@prisma/client';

import { createPrismaRepositories } from '../../app/services/repositories/index.js';
import { PrismaConversationStore } from '../../conversation/store_prisma.js';
import { createPrismaClient } from '../../db/client.js';
import type { ServiceProvider } from '../provider.js';
import { TOKENS } from '../tokens.js';

export const prismaProvider: ServiceProvider = {
  provide: TOKENS.prisma,
  useFactory: () => createPrismaClient()
};

export const repositoriesProvider: ServiceProvider = {
  provide: TOKENS.repos,
  deps: [TOKENS.prisma],
  useFactory: (deps) => {
     
    const { prisma } = deps as unknown as { prisma: PrismaClient };
    return createPrismaRepositories(prisma);
  }
};

export const conversationStoreProvider: ServiceProvider = {
  provide: TOKENS.conversationStore,
  deps: [TOKENS.prisma],
  useFactory: (deps) => {
     
    const { prisma } = deps as unknown as { prisma: PrismaClient };
    return new PrismaConversationStore(prisma);
  }
};
