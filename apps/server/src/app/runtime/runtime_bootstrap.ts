import type { DatabaseHealthSnapshot } from '../../db/sqlite_runtime.js';

export interface RuntimeDatabaseBootstrap {
  prepareDatabase(): Promise<DatabaseHealthSnapshot>;
  getDatabaseHealth(): DatabaseHealthSnapshot | null;
}
