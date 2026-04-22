import { spawn } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PrismaClient } from '@prisma/client';

import type { RunningServer, TestServerOptions } from './server.js';
import { withTestServer } from './server.js';

const helpersDirectory = dirname(fileURLToPath(import.meta.url));
const serverRoot = resolve(helpersDirectory, '../..');
const bundledConfigTemplatePaths = {
  default: join(serverRoot, 'templates', 'configw', 'default.yaml'),
  development: join(serverRoot, 'templates', 'configw', 'development.yaml'),
  production: join(serverRoot, 'templates', 'configw', 'production.yaml'),
  test: join(serverRoot, 'templates', 'configw', 'test.yaml')
} as const;
const bundledWorldPackTemplatePaths = {
  death_note: join(serverRoot, 'templates', 'world-pack', 'death_note.yaml'),
  example_pack: join(serverRoot, 'templates', 'world-pack', 'example_pack.yaml')
} as const;
const bundledWorldPackReadmeTemplatePaths = {
  death_note: join(serverRoot, 'templates', 'world-pack', 'death_note.README.md'),
  example_pack: join(serverRoot, 'templates', 'world-pack', 'example_pack.README.md')
} as const;
const bundledWorldPackChangelogTemplatePaths = {
  death_note: join(serverRoot, 'templates', 'world-pack', 'death_note.CHANGELOG.md'),
  example_pack: join(serverRoot, 'templates', 'world-pack', 'example_pack.CHANGELOG.md')
} as const;
const worldEngineSidecarBinaryPath = join(serverRoot, 'rust', 'world_engine_sidecar', 'target', 'debug', 'world_engine_sidecar');
const schedulerDecisionSidecarBinaryPath = join(serverRoot, 'rust', 'scheduler_decision_sidecar', 'target', 'debug', 'scheduler_decision_sidecar');
const memoryTriggerSidecarBinaryPath = join(serverRoot, 'rust', 'memory_trigger_sidecar', 'target', 'debug', 'memory_trigger_sidecar');
const bundledAiModelsConfigPath = join(serverRoot, 'config', 'ai_models.yaml');

const DEFAULT_SEEDED_PACK_REFS = ['death_note'] as const;

type SeededPackRef = keyof typeof bundledWorldPackTemplatePaths;

export interface IsolatedRuntimeEnvironment {
  rootDir: string;
  worldPacksDir: string;
  databasePath: string;
  databaseUrl: string;
  envOverrides: Record<string, string>;
  cleanup: () => Promise<void>;
}

export interface CreateIsolatedRuntimeEnvironmentOptions {
  appEnv?: string;
  databaseFileName?: string;
  envOverrides?: Record<string, string>;
  seededPackRefs?: SeededPackRef[];
  activePackRef?: string;
}

export interface IsolatedTestServerOptions extends Omit<TestServerOptions, 'prepareRuntime'> {
  appEnv?: string;
  databaseFileName?: string;
  prepareRuntime?: boolean;
  seededPackRefs?: SeededPackRef[];
  activePackRef?: string;
}

const runServerCommand = async (
  args: string[],
  envOverrides: Record<string, string>,
  timeoutMs: number
): Promise<void> => {
  await new Promise<void>((resolvePromise, rejectPromise) => {
    const logs: string[] = [];
    const child = spawn('pnpm', args, {
      cwd: serverRoot,
      env: {
        ...process.env,
        ...envOverrides
      },
      stdio: ['ignore', 'pipe', 'pipe']
    });

    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      rejectPromise(new Error(`${args.join(' ')} timed out after ${timeoutMs}ms\n${logs.join('')}`));
    }, timeoutMs);

    child.stdout?.on('data', chunk => {
      logs.push(String(chunk));
    });

    child.stderr?.on('data', chunk => {
      logs.push(String(chunk));
    });

    child.once('exit', code => {
      clearTimeout(timer);
      if (code === 0) {
        resolvePromise();
        return;
      }

      rejectPromise(new Error(`${args.join(' ')} exited with code=${String(code)}\n${logs.join('')}`));
    });
  });
};

const normalizeSeededPackRefs = (seededPackRefs?: SeededPackRef[]): SeededPackRef[] => {
  return seededPackRefs && seededPackRefs.length > 0
    ? seededPackRefs
    : [...DEFAULT_SEEDED_PACK_REFS];
};

const seedBundledWorldPacks = async (worldPacksDir: string, seededPackRefs?: SeededPackRef[]): Promise<void> => {
  for (const packRef of normalizeSeededPackRefs(seededPackRefs)) {
    const templatePath = bundledWorldPackTemplatePaths[packRef];
    if (!templatePath) {
      throw new Error(`Unsupported seeded pack ref: ${packRef}`);
    }

    const targetPackDir = join(worldPacksDir, packRef);
    await mkdir(targetPackDir, { recursive: true });
    await copyFile(
      templatePath,
      join(targetPackDir, 'config.yaml')
    );
  }
};

const seedVersionManagedRuntimeTemplates = async (rootDir: string): Promise<void> => {
  const configTemplateDir = join(rootDir, 'apps', 'server', 'templates', 'configw');
  const worldPackTemplateDir = join(rootDir, 'apps', 'server', 'templates', 'world-pack');
  const aiModelsConfigTargetPath = join(rootDir, 'apps', 'server', 'config', 'ai_models.yaml');

  await mkdir(configTemplateDir, { recursive: true });
  await mkdir(worldPackTemplateDir, { recursive: true });
  await mkdir(join(rootDir, 'apps', 'server', 'config'), { recursive: true });

  for (const [basename, sourcePath] of Object.entries(bundledConfigTemplatePaths)) {
    await copyFile(sourcePath, join(configTemplateDir, `${basename}.yaml`));
  }

  for (const [packRef, sourcePath] of Object.entries(bundledWorldPackTemplatePaths) as Array<[SeededPackRef, string]>) {
    await copyFile(sourcePath, join(worldPackTemplateDir, `${packRef}.yaml`));
  }

  for (const [packRef, sourcePath] of Object.entries(bundledWorldPackReadmeTemplatePaths) as Array<[SeededPackRef, string]>) {
    await copyFile(sourcePath, join(worldPackTemplateDir, `${packRef}.README.md`));
  }

  for (const [packRef, sourcePath] of Object.entries(bundledWorldPackChangelogTemplatePaths) as Array<[SeededPackRef, string]>) {
    await copyFile(sourcePath, join(worldPackTemplateDir, `${packRef}.CHANGELOG.md`));
  }

  await copyFile(bundledAiModelsConfigPath, aiModelsConfigTargetPath);
};

export const createIsolatedRuntimeEnvironment = async (
  options: CreateIsolatedRuntimeEnvironmentOptions = {}
): Promise<IsolatedRuntimeEnvironment> => {
  const rootDir = await mkdtemp(join(os.tmpdir(), 'yidhras-vitest-'));
  const runtimeDir = join(rootDir, 'runtime');
  const databaseFileName = options.databaseFileName ?? 'yidhras.sqlite';
  const databasePath = join(runtimeDir, 'db', databaseFileName);
  const worldPacksDir = join(rootDir, 'data', 'world_packs');

  await mkdir(join(runtimeDir, 'db'), { recursive: true });
  await mkdir(worldPacksDir, { recursive: true });
  await seedVersionManagedRuntimeTemplates(rootDir);
  await seedBundledWorldPacks(worldPacksDir, options.seededPackRefs);

  const databaseUrl = `file:${databasePath}`;
  const envOverrides: Record<string, string> = {
    APP_ENV: options.appEnv ?? 'test',
    DATABASE_URL: databaseUrl,
    DEV_RUNTIME_RESET_ON_START: '0',
    NODE_ENV: 'test',
    WORLD_BOOTSTRAP_ENABLED: 'false',
    WORLD_ENGINE_BINARY_PATH: worldEngineSidecarBinaryPath,
    SCHEDULER_AGENT_DECISION_KERNEL_BINARY_PATH: schedulerDecisionSidecarBinaryPath,
    MEMORY_TRIGGER_ENGINE_BINARY_PATH: memoryTriggerSidecarBinaryPath,
    WORKSPACE_ROOT: rootDir,
    ...(options.activePackRef ? { WORLD_PACK: options.activePackRef } : {}),
    WORLD_PACKS_DIR: worldPacksDir,
    ...(options.envOverrides ?? {})
  };

  return {
    rootDir,
    worldPacksDir,
    databasePath,
    databaseUrl,
    envOverrides,
    cleanup: async () => {
      await rm(rootDir, { force: true, recursive: true });
    }
  };
};

export const migrateIsolatedDatabase = async (
  environment: IsolatedRuntimeEnvironment,
  timeoutMs = 120_000
): Promise<void> => {
  await runServerCommand(['exec', 'prisma', 'migrate', 'deploy'], environment.envOverrides, timeoutMs);
};

export const prepareIsolatedRuntime = async (
  environment: IsolatedRuntimeEnvironment,
  timeoutMs = 120_000
): Promise<void> => {
  await runServerCommand(['run', 'prepare:runtime'], environment.envOverrides, timeoutMs);
};

export const createPrismaClientForEnvironment = (environment: IsolatedRuntimeEnvironment): PrismaClient => {
  return new PrismaClient({
    datasources: {
      db: {
        url: environment.databaseUrl
      }
    }
  });
};

export const withIsolatedTestServer = async <T>(
  options: IsolatedTestServerOptions,
  run: (server: RunningServer) => Promise<T>
): Promise<T> => {
  const environment = await createIsolatedRuntimeEnvironment({
    appEnv: options.appEnv,
    databaseFileName: options.databaseFileName,
    seededPackRefs: options.seededPackRefs,
    activePackRef: options.activePackRef,
    envOverrides: options.envOverrides
  });

  try {
    if (options.prepareRuntime !== false) {
      await prepareIsolatedRuntime(environment, options.prepareTimeoutMs);
    }

    return await withTestServer(
      {
        ...options,
        envOverrides: {
          ...environment.envOverrides,
          ...(options.envOverrides ?? {})
        },
        prepareRuntime: false
      },
      run
    );
  } finally {
    await environment.cleanup();
  }
};
