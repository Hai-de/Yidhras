import type { PrismaClient } from '@prisma/client';

import type { Repositories } from '../../src/app/services/repositories/index.js';

export const wrapPrismaAsRepositories = (prisma: PrismaClient): Repositories => {
  return {
    inference: { getPrisma: () => prisma } as Repositories['inference'],
    identityOperator: { getPrisma: () => prisma } as Repositories['identityOperator'],
    memory: { getPrisma: () => prisma } as Repositories['memory'],
    narrative: { getPrisma: () => prisma } as Repositories['narrative'],
    relationship: { getPrisma: () => prisma } as Repositories['relationship'],
    plugin: { getPrisma: () => prisma } as Repositories['plugin'],
    scheduler: { getPrisma: () => prisma } as Repositories['scheduler'],
    agent: { getPrisma: () => prisma } as Repositories['agent'],
    social: { getPrisma: () => prisma } as Repositories['social']
  };
};
