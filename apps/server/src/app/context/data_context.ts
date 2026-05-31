import type { PrismaClient } from '@prisma/client';

import type { DatabaseHealthSnapshot } from '../../db/sqlite_runtime.js';
import type { PackStorageAdapter } from '../../packs/storage/PackStorageAdapter.js';
import type { SchedulerStorageAdapter } from '../../packs/storage/SchedulerStorageAdapter.js';

export interface DataContext {
  readonly repos: import('../services/repositories/entity_repos.js').EntityRepositories &
    import('../services/repositories/workflow_repos.js').WorkflowRepositories &
    import('../services/repositories/plugin_repos.js').PluginRepositories;
  readonly prisma: PrismaClient;
  readonly packStorageAdapter: PackStorageAdapter;
  readonly schedulerStorage?: SchedulerStorageAdapter;
  getDatabaseHealth(): DatabaseHealthSnapshot | null;
}
