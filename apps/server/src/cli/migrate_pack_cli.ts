/**
 * Pack data migration CLI.
 *
 * Usage:
 *   pnpm --filter yidhras-server db:migrate-pack <packId> [--target-version <n>]
 *
 * Loads pack config.yaml, detects schema_version, executes migration chain,
 * writes back with automatic .bak backup.
 */

import { copyFile, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import YAML from 'yaml';

import { getRuntimeConfig } from '../config/runtime_config.js';
import { migrateConfig } from '../packs/migrations/registry.js';

const parseArgs = (argv: string[]): { packId?: string; targetVersion?: number; help?: boolean } => {
  const parsed: { packId?: string; targetVersion?: number; help?: boolean } = {};

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case '--help':
      case '-h':
        parsed.help = true;
        break;
      case '--target-version': {
        const val = parseInt(argv[++i], 10);
        if (!Number.isNaN(val)) parsed.targetVersion = val;
        break;
      }
      default:
        if (!arg.startsWith('-') && !parsed.packId) {
          parsed.packId = arg;
        }
    }
  }

  return parsed;
};

const printHelp = (): void => {
  console.log(`db migrate-pack — Migrate a world pack config to the latest schema version

Usage:
  pnpm --filter yidhras-server db:migrate-pack <packId> [--target-version <n>]

Options:
  --target-version  Target schema version (default: latest available)
  --help, -h        Show this help
`);
};

const resolvePackDir = (packId: string): string => {
  const worldPacksDir = getRuntimeConfig().paths.world_packs_dir;
  return join(worldPacksDir, packId);
};

const resolveConfigPath = (packDir: string): string => {
  return join(packDir, 'pack.yaml');
};

const runMigration = async (): Promise<void> => {
  const args = parseArgs(process.argv.slice(2));

  if (args.help || !args.packId) {
    printHelp();
    process.exitCode = args.help ? 0 : 1;
    return;
  }

  const packDir = resolvePackDir(args.packId);
  const configPath = resolveConfigPath(packDir);

  let raw: string;
  try {
    raw = await readFile(configPath, 'utf-8');
  } catch {
    console.error(`Cannot read pack config at ${configPath}`);
    process.exitCode = 1;
    return;
  }

  const config = YAML.parse(raw) as Record<string, unknown>;
  const currentVersion = (config.schema_version as number) ?? 0;

  console.error(`Current schema_version: ${currentVersion}`);

  const result = migrateConfig(config, args.targetVersion);

  if (result.applied.length === 0) {
    console.error('Already at target version. No migrations applied.');
    return;
  }

  // Backup
  const backupPath = `${configPath}.bak`;
  await copyFile(configPath, backupPath);
  console.error(`Backup saved to ${backupPath}`);

  // Write migrated config
  const newYaml = YAML.stringify(result.config);
  await writeFile(configPath, newYaml, 'utf-8');

  console.error('Migrations applied:');
  for (const m of result.applied) {
    console.error(`  v${m.version}: ${m.description}`);
  }
  console.error(`Schema version updated: ${currentVersion} → ${result.config.schema_version}`);

  // Output the migrated config to stdout
  console.log(newYaml);
};

runMigration().catch((err) => {
  console.error('Migration failed:', err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
