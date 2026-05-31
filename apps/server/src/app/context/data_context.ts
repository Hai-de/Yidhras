import type { PrismaClient } from '@prisma/client';

import type { DatabaseHealthSnapshot } from '../../db/sqlite_runtime.js';
import type { PackStorageAdapter } from '../../packs/storage/PackStorageAdapter.js';
import type { SchedulerStorageAdapter } from '../../packs/storage/SchedulerStorageAdapter.js';
import type { Repositories } from '../services/repositories/types.js';

export interface DataContext {
  readonly repos: Repositories;
  readonly prisma: PrismaClient;
  readonly packStorageAdapter: PackStorageAdapter;
  readonly schedulerStorage?: SchedulerStorageAdapter;
  getDatabaseHealth(): DatabaseHealthSnapshot | null;
}
