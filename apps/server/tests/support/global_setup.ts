import { rm } from 'node:fs/promises';

import { createIsolatedRuntimeEnvironment, migrateIsolatedDatabase } from '../helpers/runtime.js';

const TEMPLATE_ENV_KEY = 'YIDHRAS_TEST_DB_TEMPLATE';

export async function setup(): Promise<() => Promise<void>> {
  let templateDir: string | null = null;

  try {
    const environment = await createIsolatedRuntimeEnvironment({
      appEnv: 'test',
      databaseFileName: 'template.sqlite'
    });
    templateDir = environment.rootDir;

    await migrateIsolatedDatabase(environment, 180_000);

    process.env[TEMPLATE_ENV_KEY] = environment.databasePath;

    return async () => {
      delete process.env[TEMPLATE_ENV_KEY];
      if (templateDir) {
        await rm(templateDir, { recursive: true, force: true }).catch(() => {});
      }
    };
  } catch (err) {
    // Template creation failed — tests will fall back to per-file migration
    console.warn(`[global_setup] DB template creation failed, tests will migrate per-file: ${String(err)}`);
    if (templateDir) {
      await rm(templateDir, { recursive: true, force: true }).catch(() => {});
    }
    return async () => {};
  }
}
