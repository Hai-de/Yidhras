import type { PrismaClient } from '@prisma/client';

import type { Repositories } from '../../src/app/services/repositories/index.js';
import { createPrismaRepositories } from '../../src/app/services/repositories/index.js';

export const wrapPrismaAsRepositories = (prisma: PrismaClient): Repositories => {
  return createPrismaRepositories(prisma);
};
