/* eslint-disable @typescript-eslint/no-unsafe-type-assertion -- deps cast from ServiceContainer Record<string, unknown> */
import type { PrismaClient } from '@prisma/client';

import { PostgresPackStorageAdapter } from '../../packs/storage/internal/PostgresPackStorageAdapter.js';
import { SqlitePackStorageAdapter } from '../../packs/storage/internal/SqlitePackStorageAdapter.js';
import { SqliteSchedulerStorageAdapter } from '../../packs/storage/internal/SqliteSchedulerStorageAdapter.js';
import type { ServiceProvider } from '../provider.js';
import { TOKENS } from '../tokens.js';

export const packStorageAdapterProvider: ServiceProvider = {
  provide: TOKENS.packStorageAdapter,
  deps: [TOKENS.prisma],
  useFactory: (deps) => {
     
    const { prisma } = deps as unknown as { prisma: PrismaClient };
    const dbProvider = process.env.PRISMA_DB_PROVIDER ?? 'sqlite';
    return dbProvider === 'postgresql'
      ? new PostgresPackStorageAdapter(prisma)
      : new SqlitePackStorageAdapter();
  }
};

export const schedulerStorageProvider: ServiceProvider = {
  provide: TOKENS.schedulerStorage,
  useFactory: () => new SqliteSchedulerStorageAdapter()
};
