import type { PrismaClient } from '@prisma/client';

import type { Repositories } from '../../src/app/services/repositories/index.js';
import { createPrismaRepositories } from '../../src/app/services/repositories/index.js';
import type { DeepMockProxy } from './prisma_mock.js';

export const wrapPrismaAsRepositories = (
  prisma: PrismaClient | DeepMockProxy<PrismaClient>
): Repositories => {
  return createPrismaRepositories(prisma as PrismaClient);
};
