import type { PrismaClient } from '@prisma/client';

import type { AppContext } from '../../src/app/context.js';
import type { IsolatedRuntimeEnvironment } from '../helpers/runtime.js';
import {
  createIsolatedRuntimeEnvironment,
  createPrismaClientForEnvironment,
  migrateIsolatedDatabase
} from '../helpers/runtime.js';
import { createTestAppContext } from './app-context.js';

export interface IsolatedAppContextFixture {
  environment: IsolatedRuntimeEnvironment;
  prisma: PrismaClient;
  context: AppContext;
  cleanup: () => Promise<void>;
}

export const createIsolatedAppContextFixture = async (): Promise<IsolatedAppContextFixture> => {
  const environment = await createIsolatedRuntimeEnvironment();

  try {
    await migrateIsolatedDatabase(environment);
    const prisma = createPrismaClientForEnvironment(environment);
    const context = createTestAppContext(prisma);

    return {
      environment,
      prisma,
      context,
      cleanup: async () => {
        await prisma.$disconnect();
        await environment.cleanup();
      }
    };
  } catch (error) {
    await environment.cleanup();
    throw error;
  }
};
