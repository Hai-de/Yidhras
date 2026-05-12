export interface PackMigration {
  version: number;
  description: string;
  up: (config: Record<string, unknown>) => Record<string, unknown>;
}

const migrations: PackMigration[] = [
  // Example migration — add future migrations here:
  // {
  //   version: 1,
  //   description: 'Migrate actions to rules.objective_enforcement',
  //   up(config) {
  //     // ... migration logic
  //     return config;
  //   }
  // }
];

const sortedMigrations = [...migrations].sort((a, b) => a.version - b.version);

export const getAvailableMigrations = (): readonly PackMigration[] => sortedMigrations;

export const getTargetVersion = (): number => {
  if (sortedMigrations.length === 0) return 0;
  return sortedMigrations[sortedMigrations.length - 1].version;
};

export const migrateConfig = (
  config: Record<string, unknown>,
  targetVersion?: number
): { config: Record<string, unknown>; applied: PackMigration[] } => {
  const currentVersion = (config.schema_version as number) ?? 0;
  const target = targetVersion ?? getTargetVersion();

  if (target <= currentVersion) {
    return { config, applied: [] };
  }

  const applied: PackMigration[] = [];
  let data = { ...config };

  for (const migration of sortedMigrations) {
    if (migration.version <= currentVersion) continue;
    if (migration.version > target) break;

    data = migration.up(data);
    applied.push(migration);
  }

  return {
    config: { ...data, schema_version: target },
    applied
  };
};
