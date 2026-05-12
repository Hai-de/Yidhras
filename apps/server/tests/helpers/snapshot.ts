import { copyFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * Copies a pre-built pack runtime.sqlite snapshot into an isolated test
 * environment, so tests can start from a known simulation state instead of
 * running the full bootstrap + sim loop from scratch.
 *
 * Usage:
 *   const packDbPath = await seedPackFromSnapshot(
 *     environment.worldPacksDir,
 *     'death_note',
 *     'tests/fixtures/snapshots/death_note_tick10.sqlite'
 *   );
 */

export const seedPackFromSnapshot = async (
  worldPacksDir: string,
  packDirName: string,
  snapshotPath: string
): Promise<string> => {
  const packRuntimeDir = join(worldPacksDir, packDirName, 'runtime');
  const targetPath = join(packRuntimeDir, 'runtime.sqlite');

  await mkdir(packRuntimeDir, { recursive: true });
  await copyFile(snapshotPath, targetPath);

  return targetPath;
};

/**
 * Seeds a pack's config.yaml from a template and copies a pre-built
 * runtime snapshot. Returns the pack directory path.
 */
export const seedPackWithConfigAndSnapshot = async (
  worldPacksDir: string,
  packDirName: string,
  configTemplatePath: string,
  snapshotPath: string
): Promise<string> => {
  const packDir = join(worldPacksDir, packDirName);

  await mkdir(packDir, { recursive: true });
  await copyFile(configTemplatePath, join(packDir, 'config.yaml'));
  await seedPackFromSnapshot(worldPacksDir, packDirName, snapshotPath);

  return packDir;
};
