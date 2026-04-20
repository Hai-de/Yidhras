import type { PrismaClient } from '@prisma/client';

import type { RuntimeDatabaseBootstrap } from '../app/runtime/runtime_bootstrap.js';
import {
  applySqliteRuntimePragmas,
  type SqliteRuntimePragmaSnapshot
} from '../db/sqlite_runtime.js';

export interface PrismaRuntimeDatabaseBootstrapOptions {
  prisma: PrismaClient;
  applyPragmas?: (prisma: PrismaClient) => Promise<SqliteRuntimePragmaSnapshot>;
  log?: (message: string) => void;
}

export class PrismaRuntimeDatabaseBootstrap implements RuntimeDatabaseBootstrap {
  private readonly prisma: PrismaClient;
  private readonly applyPragmas: (prisma: PrismaClient) => Promise<SqliteRuntimePragmaSnapshot>;
  private readonly log: (message: string) => void;
  private sqliteRuntimePragmas: SqliteRuntimePragmaSnapshot | null = null;

  constructor(options: PrismaRuntimeDatabaseBootstrapOptions) {
    this.prisma = options.prisma;
    this.applyPragmas = options.applyPragmas ?? applySqliteRuntimePragmas;
    this.log = options.log ?? console.log;
  }

  public async prepareDatabase(): Promise<SqliteRuntimePragmaSnapshot> {
    if (this.sqliteRuntimePragmas !== null) {
      return this.sqliteRuntimePragmas;
    }

    this.sqliteRuntimePragmas = await this.applyPragmas(this.prisma);
    this.log(
      `[SimulationManager] SQLite pragmas journal_mode=${this.sqliteRuntimePragmas.journal_mode} busy_timeout=${String(
        this.sqliteRuntimePragmas.busy_timeout
      )} synchronous=${this.sqliteRuntimePragmas.synchronous} foreign_keys=${String(
        this.sqliteRuntimePragmas.foreign_keys
      )} wal_autocheckpoint=${String(this.sqliteRuntimePragmas.wal_autocheckpoint)}`
    );

    return this.sqliteRuntimePragmas;
  }

  public getSqliteRuntimePragmaSnapshot(): SqliteRuntimePragmaSnapshot | null {
    return this.sqliteRuntimePragmas;
  }
}
