import type { SqliteRuntimePragmaSnapshot } from '../../db/sqlite_runtime.js';

export interface RuntimeDatabaseBootstrap {
  prepareDatabase(): Promise<SqliteRuntimePragmaSnapshot>;
  getSqliteRuntimePragmaSnapshot(): SqliteRuntimePragmaSnapshot | null;
}
