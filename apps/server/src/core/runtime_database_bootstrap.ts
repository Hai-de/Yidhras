import type { PrismaClient } from '@prisma/client';

import type { RuntimeDatabaseBootstrap } from '../app/runtime/runtime_bootstrap.js';
import {
  applySqliteRuntimePragmas,
  type DatabaseHealthSnapshot
} from '../db/sqlite_runtime.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('runtime-database-bootstrap');

export interface PrismaRuntimeDatabaseBootstrapOptions {
  prisma: PrismaClient;
  applyPragmas?: (prisma: PrismaClient) => Promise<DatabaseHealthSnapshot>;
  log?: (message: string) => void;
}

const defaultApplyPragmas = async (prisma: PrismaClient): Promise<DatabaseHealthSnapshot> => {
  const sqlite = await applySqliteRuntimePragmas(prisma);
  return { provider: 'sqlite', connected: true, sqlite };
};

export class PrismaRuntimeDatabaseBootstrap implements RuntimeDatabaseBootstrap {
  private readonly prisma: PrismaClient;
  private readonly applyPragmas: (prisma: PrismaClient) => Promise<DatabaseHealthSnapshot>;
  private readonly log: (message: string) => void;
  private databaseHealth: DatabaseHealthSnapshot | null = null;

  constructor(options: PrismaRuntimeDatabaseBootstrapOptions) {
    this.prisma = options.prisma;
    this.applyPragmas = options.applyPragmas ?? defaultApplyPragmas;
    this.log = options.log ?? ((msg: string) => { logger.info(msg); });
  }

  public async prepareDatabase(): Promise<DatabaseHealthSnapshot> {
    if (this.databaseHealth !== null) {
      return this.databaseHealth;
    }

    this.databaseHealth = await this.applyPragmas(this.prisma);
    if (this.databaseHealth.sqlite) {
      this.log(
        `SQLite pragmas journal_mode=${this.databaseHealth.sqlite.journal_mode} busy_timeout=${String(
          this.databaseHealth.sqlite.busy_timeout
        )} synchronous=${this.databaseHealth.sqlite.synchronous} foreign_keys=${String(
          this.databaseHealth.sqlite.foreign_keys
        )} wal_autocheckpoint=${String(this.databaseHealth.sqlite.wal_autocheckpoint)}`
      );
    } else {
      this.log(`Database health: provider=${this.databaseHealth.provider} connected=${String(this.databaseHealth.connected)}`);
    }

    return this.databaseHealth;
  }

  public getDatabaseHealth(): DatabaseHealthSnapshot | null {
    return this.databaseHealth;
  }
}
