import { createPrismaRepositories } from '../../app/services/repositories/factory.js';
import { PrismaConversationStore } from '../../conversation/store_prisma.js';
import { createPrismaClient } from '../../db/client.js';
import { TOKENS } from '../tokens.js';

export const prismaProvider = {
  provide: TOKENS.prisma,
  useFactory: () => createPrismaClient()
} as const satisfies import('../provider.js').ServiceProvider;

export const repositoriesProvider = {
  provide: TOKENS.repos,
  deps: [TOKENS.prisma] as const,
  useFactory: (deps) => createPrismaRepositories(deps.prisma)
} as const satisfies import('../provider.js').ServiceProvider;

export const conversationStoreProvider = {
  provide: TOKENS.conversationStore,
  deps: [TOKENS.prisma] as const,
  useFactory: (deps) => new PrismaConversationStore(deps.prisma)
} as const satisfies import('../provider.js').ServiceProvider;
