import { PostgresPackStorageAdapter } from '../../packs/storage/internal/PostgresPackStorageAdapter.js';
import { SqlitePackStorageAdapter } from '../../packs/storage/internal/SqlitePackStorageAdapter.js';
import { SqliteSchedulerStorageAdapter } from '../../packs/storage/internal/SqliteSchedulerStorageAdapter.js';
import { TOKENS } from '../tokens.js';

export const packStorageAdapterProvider = {
  provide: TOKENS.packStorageAdapter,
  deps: [TOKENS.prisma] as const,
  useFactory: (deps) => {
    const dbProvider = process.env['PRISMA_DB_PROVIDER'] ?? 'sqlite';
    return dbProvider === 'postgresql'
      ? new PostgresPackStorageAdapter(deps.prisma)
      : new SqlitePackStorageAdapter();
  }
} as const satisfies import('../provider.js').ServiceProvider;

export const schedulerStorageProvider = {
  provide: TOKENS.schedulerStorage,
  useFactory: () => new SqliteSchedulerStorageAdapter()
} as const satisfies import('../provider.js').ServiceProvider;
