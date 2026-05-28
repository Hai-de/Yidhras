import { copyFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

import type { PrismaClient } from '@prisma/client';

import type { SchedulerStorageAdapter } from '../src/packs/storage/SchedulerStorageAdapter.js';
import { createTestAppContext } from './fixtures/app-context.js';
import type { CreateIsolatedRuntimeEnvironmentOptions, IsolatedRuntimeEnvironment } from './helpers/runtime.js';
import {
  createIsolatedRuntimeEnvironment,
  createPrismaClientForEnvironment,
  migrateIsolatedDatabase
} from './helpers/runtime.js';
import type { MutableTestContext } from './types.js';

export interface TestKitOptions extends CreateIsolatedRuntimeEnvironmentOptions {
  schedulerStorage?: SchedulerStorageAdapter;
  skipMigration?: boolean;
}

export class TestKit implements AsyncDisposable {
  readonly environment: IsolatedRuntimeEnvironment;
  prisma!: PrismaClient;
  context!: MutableTestContext;
  protected cleanupStack: Array<() => Promise<void>> = [];
  private disposed = false;

  protected constructor(environment: IsolatedRuntimeEnvironment) {
    this.environment = environment;
  }

  static async create(options: TestKitOptions = {}): Promise<TestKit> {
    const { schedulerStorage, skipMigration, ...envOptions } = options;

    // 1. Create isolated environment (temp dir + seed files + env vars)
    const environment = await createIsolatedRuntimeEnvironment(envOptions);

    // 2. Apply env overrides so process.env is correct for the app code
    const prevEnv: Record<string, string | undefined> = {};
    for (const [k, v] of Object.entries(environment.envOverrides)) {
      prevEnv[k] = process.env[k];
      process.env[k] = v;
    }

    const kit = new TestKit(environment);

    // Register env restore as first cleanup step
    kit.cleanupStack.push(async () => {
      for (const [k, v] of Object.entries(prevEnv)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    });

    try {
      // 3. Migrate database (unless skipped)
      if (!skipMigration) {
        const templatePath = process.env.YIDHRAS_TEST_DB_TEMPLATE;
        if (templatePath) {
          await mkdir(dirname(environment.databasePath), { recursive: true });
          await copyFile(templatePath, environment.databasePath);
        } else {
          await migrateIsolatedDatabase(environment);
        }
      }

      // 4. Create PrismaClient
      kit.prisma = createPrismaClientForEnvironment(environment);
      kit.cleanupStack.push(async () => {
        await kit.prisma.$disconnect();
      });

      // 5. Build test AppContext
      const baseContext = createTestAppContext(kit.prisma, {
        schedulerStorage
      });
      kit.context = baseContext as MutableTestContext;

      // 6. Register temp dir cleanup (runs last)
      kit.cleanupStack.push(async () => {
        await environment.cleanup();
      });

      return kit;
    } catch (err) {
      // Construction failed — cleanup what was created so far
      for (const fn of kit.cleanupStack.reverse()) {
        await fn();
      }
      throw err;
    }
  }

  withSchedulerStorage(adapter: SchedulerStorageAdapter): this {
    this.context.schedulerStorage = adapter;
    return this;
  }

  get databaseUrl(): string {
    return this.environment.databaseUrl;
  }

  get worldPacksDir(): string {
    return this.environment.worldPacksDir;
  }

  async [Symbol.asyncDispose](): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    for (const fn of this.cleanupStack.reverse()) {
      await fn();
    }
  }
}
