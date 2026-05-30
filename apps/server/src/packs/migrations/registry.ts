export interface PackMigration {
  version: number;
  description: string;
  up: (config: Record<string, unknown>) => Record<string, unknown>;
}

export interface PackMigrationPlan {
  currentVersion: number;
  targetVersion: number;
  latestVersion: number;
  needsMigration: boolean;
  applied: readonly PackMigration[];
}

export interface PackMigrationResult extends PackMigrationPlan {
  config: Record<string, unknown>;
}

const migrations: PackMigration[] = [
  {
    version: 1,
    description: 'Mark pack manifest as schema_version 1 without changing manifest semantics',
    up(config) {
      return { ...config };
    }
  }
];

const sortedMigrations = [...migrations].sort((a, b) => a.version - b.version);

const assertMigrationRegistryValid = (): void => {
  const seen = new Set<number>();
  let previous = 0;

  for (const migration of sortedMigrations) {
    if (!Number.isInteger(migration.version) || migration.version <= 0) {
      throw new Error(`Invalid pack migration version: ${String(migration.version)}`);
    }
    if (seen.has(migration.version)) {
      throw new Error(`Duplicate pack migration version: ${String(migration.version)}`);
    }
    if (migration.version !== previous + 1) {
      throw new Error(`Pack migration registry has a gap between v${String(previous)} and v${String(migration.version)}`);
    }
    seen.add(migration.version);
    previous = migration.version;
  }
};

assertMigrationRegistryValid();

export const getAvailableMigrations = (): readonly PackMigration[] => sortedMigrations;

export const getTargetVersion = (): number => {
  if (sortedMigrations.length === 0) return 0;
  return sortedMigrations[sortedMigrations.length - 1]!.version;
};

const serializeUnknown = (value: unknown): string => {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') return String(value);
  if (value === null || value === undefined) return String(value);
  if (typeof value === 'symbol') return value.description ?? 'symbol';
  if (typeof value === 'function') return value.name ? `[function ${value.name}]` : '[function]';
  return JSON.stringify(value);
};

const parseSchemaVersion = (config: Record<string, unknown>): number => {
  const rawVersion = config['schema_version'];
  if (rawVersion === undefined || rawVersion === null) {
    return 0;
  }
  if (!Number.isInteger(rawVersion) || typeof rawVersion !== 'number' || rawVersion < 0) {
    throw new Error(`Invalid pack schema_version: ${serializeUnknown(rawVersion)}`);
  }
  return rawVersion;
};

const selectMigrations = (currentVersion: number, targetVersion: number): readonly PackMigration[] => {
  if (!Number.isInteger(targetVersion) || targetVersion < 0) {
    throw new Error(`Invalid target schema version: ${String(targetVersion)}`);
  }

  const latestVersion = getTargetVersion();
  if (targetVersion > latestVersion) {
    throw new Error(`Target schema version ${String(targetVersion)} is newer than latest supported version ${String(latestVersion)}`);
  }

  if (targetVersion < currentVersion) {
    throw new Error(`Downgrading pack schema_version from ${String(currentVersion)} to ${String(targetVersion)} is not supported`);
  }

  return sortedMigrations.filter(migration => migration.version > currentVersion && migration.version <= targetVersion);
};

export const planMigration = (
  config: Record<string, unknown>,
  targetVersion = getTargetVersion()
): PackMigrationPlan => {
  const currentVersion = parseSchemaVersion(config);
  const latestVersion = getTargetVersion();
  const applied = selectMigrations(currentVersion, targetVersion);

  return {
    currentVersion,
    targetVersion,
    latestVersion,
    needsMigration: currentVersion < targetVersion,
    applied
  };
};

export const migrateConfig = (
  config: Record<string, unknown>,
  targetVersion = getTargetVersion()
): PackMigrationResult => {
  const plan = planMigration(config, targetVersion);

  if (!plan.needsMigration) {
    return { ...plan, config: { ...config } };
  }

  if (plan.applied.length !== plan.targetVersion - plan.currentVersion) {
    throw new Error(
      `No complete pack migration path from schema_version ${String(plan.currentVersion)} to ${String(plan.targetVersion)}`
    );
  }

  let data = { ...config };
  for (const migration of plan.applied) {
    data = migration.up(data);
  }

  return {
    ...plan,
    config: { ...data, schema_version: plan.targetVersion }
  };
};
