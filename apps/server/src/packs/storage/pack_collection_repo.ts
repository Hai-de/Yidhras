import { DatabaseSync } from 'node:sqlite';

import fs from 'fs';

import { createLogger } from '../../utils/logger.js';
import { stringifyJsonSafe, toJsonSafe } from './internal/json.js';
import type { PersistedStoragePlan } from './internal/plan_store.js';
import { readPersistedStoragePlan } from './internal/plan_store.js';
import { resolvePackRuntimeDatabaseLocation } from './pack_db_locator.js';

const logger = createLogger('pack-collection-repo');

export type PackCollectionRecord = Record<string, unknown>;

type PersistedPackCollectionDefinition = PersistedStoragePlan['pack_collections'][number];
type PersistedPackCollectionFieldDefinition = PersistedPackCollectionDefinition['fields'][number];

type SqlitePrimitive = string | number | null;
type SqliteRow = Record<string, unknown>;

const parseJsonString = (value: string): unknown => {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return undefined;
  }
};

const toNullableString = (value: unknown): string | null => {
  if (typeof value === 'string') {
    return value;
  }
  if (value === null || value === undefined) {
    return null;
  }
  return String(value);
};

const openDatabase = (runtimeDbPath: string): DatabaseSync => {
  return new DatabaseSync(runtimeDbPath);
};

const withRuntimeDatabase = async <T>(
  runtimeDbPath: string,
  handler: (db: DatabaseSync) => Promise<T> | T
): Promise<T> => {
  const db = openDatabase(runtimeDbPath);
  try {
    return await handler(db);
  } finally {
    db.close();
  }
};

const mapFieldTypeToSqliteType = (fieldType: string): string => {
  switch (fieldType) {
    case 'number':
      return 'REAL';
    case 'boolean':
      return 'INTEGER';
    case 'json':
    case 'tick':
    case 'string':
    case 'entity_ref':
    case 'identity_ref':
    case 'capability_ref':
    case 'mediator_ref':
    case 'authority_ref':
    case 'enum':
    default:
      return 'TEXT';
  }
};

const buildColumnDefinition = (
  field: PersistedPackCollectionFieldDefinition,
  primaryKey: string
): string => {
  const parts = [`${field.key} ${mapFieldTypeToSqliteType(field.type)}`];
  if (field.key === primaryKey) {
    parts.push('PRIMARY KEY');
  }
  if (field.required === true) {
    parts.push('NOT NULL');
  }
  return parts.join(' ');
};

const buildCreateTableStatement = (collection: PersistedPackCollectionDefinition): string => {
  const columns = collection.fields
    .map(field => buildColumnDefinition(field, collection.primary_key))
    .join(',\n      ');
  return `CREATE TABLE IF NOT EXISTS ${collection.key} (\n      ${columns}\n    )`;
};

const buildCreateIndexStatements = (collection: PersistedPackCollectionDefinition): string[] => {
  return (collection.indexes ?? []).map((fields, indexPosition) =>
    `CREATE INDEX IF NOT EXISTS idx_${collection.key}_${String(indexPosition + 1)} ON ${collection.key} (${fields.join(', ')})`
  );
};

const buildUpsertStatement = (collection: PersistedPackCollectionDefinition, columns: string[]): string => {
  const placeholders = columns.map(() => '?').join(', ');
  const assignments = columns
    .filter(column => column !== collection.primary_key)
    .map(column => `${column} = excluded.${column}`)
    .join(', ');
  return [
    `INSERT INTO ${collection.key} (${columns.join(', ')})`,
    `VALUES (${placeholders})`,
    assignments.length > 0
      ? `ON CONFLICT(${collection.primary_key}) DO UPDATE SET ${assignments}`
      : 'ON CONFLICT DO NOTHING'
  ].join(' ');
};

const encodeFieldValue = (
  field: PersistedPackCollectionFieldDefinition,
  value: unknown
): SqlitePrimitive => {
  if (value === undefined || value === null) {
    return null;
  }

  switch (field.type) {
    case 'number':
      return typeof value === 'number' && Number.isFinite(value) ? value : Number(value);
    case 'boolean':
      return value === true ? 1 : 0;
    case 'json':
      return stringifyJsonSafe(value);
    case 'tick':
    case 'string':
    case 'entity_ref':
    case 'identity_ref':
    case 'capability_ref':
    case 'mediator_ref':
    case 'authority_ref':
    case 'enum':
    default:
      return String(value);
  }
};

const decodeFieldValue = (
  field: PersistedPackCollectionFieldDefinition,
  value: unknown
): unknown => {
  if (value === null || value === undefined) {
    return null;
  }

  switch (field.type) {
    case 'number':
      return Number(value);
    case 'boolean':
      return value === 1 || value === '1' || value === true;
    case 'json': {
      if (typeof value === 'string') {
        return toJsonSafe(parseJsonString(value) ?? null);
      }
      return toJsonSafe(value);
    }
    default:
      return toNullableString(value);
  }
};

const normalizeRecordForCollection = (
  collection: PersistedPackCollectionDefinition,
  record: PackCollectionRecord
): Record<string, SqlitePrimitive> => {
  const normalized = Object.fromEntries(
    collection.fields.map(field => [field.key, encodeFieldValue(field, record[field.key])])
  );
  const primaryKeyValue = normalized[collection.primary_key];
  if (primaryKeyValue === null || primaryKeyValue === undefined || String(primaryKeyValue).trim().length === 0) {
    throw new Error(`[pack_collection_repo] collection ${collection.key} requires primary key field ${collection.primary_key}`);
  }
  for (const field of collection.fields) {
    if (field.required === true && normalized[field.key] === null) {
      throw new Error(`[pack_collection_repo] collection ${collection.key} requires field ${field.key}`);
    }
  }
  return normalized;
};

const decodeRowForCollection = (
  collection: PersistedPackCollectionDefinition,
  row: SqliteRow
): PackCollectionRecord => {
  return Object.fromEntries(
    collection.fields.map(field => [field.key, decodeFieldValue(field, row[field.key])])
  );
};

const readCollectionDefinition = (
  runtimeDbPath: string,
  collectionKey: string
): PersistedPackCollectionDefinition | null => {
  const storagePlan = readPersistedStoragePlan(`${runtimeDbPath}.storage-plan.json`);
  if (!storagePlan) {
    return null;
  }
  return storagePlan.pack_collections.find(collection => collection.key === collectionKey) ?? null;
};

export const ensureDeclaredPackCollectionTables = async (
  runtimeDbPath: string,
  collections: PersistedPackCollectionDefinition[]
): Promise<void> => {
  if (!fs.existsSync(runtimeDbPath) || collections.length === 0) {
    return;
  }

  await withRuntimeDatabase(runtimeDbPath, db => {
    for (const collection of collections) {
      db.prepare(buildCreateTableStatement(collection)).run();
      for (const statement of buildCreateIndexStatements(collection)) {
        db.prepare(statement).run();
      }
    }
  });
};

export const upsertDeclaredPackCollectionRecord = async (
  packId: string,
  collectionKey: string,
  record: PackCollectionRecord
): Promise<PackCollectionRecord | null> => {
  const location = resolvePackRuntimeDatabaseLocation(packId);
  if (!fs.existsSync(location.runtimeDbPath)) {
    logger.warn(`runtime db missing for pack=${packId} path=${location.runtimeDbPath}`);
    return null;
  }

  const collection = readCollectionDefinition(location.runtimeDbPath, collectionKey);
  if (!collection) {
    logger.warn(`collection declaration missing for pack=${packId} collection=${collectionKey} path=${location.runtimeDbPath}`);
    return null;
  }

  const normalized = normalizeRecordForCollection(collection, record);
  const columns = collection.fields.map(field => field.key);

  return withRuntimeDatabase(location.runtimeDbPath, db => {
    db.prepare(buildCreateTableStatement(collection)).run();
    for (const statement of buildCreateIndexStatements(collection)) {
      db.prepare(statement).run();
    }
    db.prepare(buildUpsertStatement(collection, columns)).run(...columns.map(column => normalized[column] ?? null));
    return decodeRowForCollection(collection, normalized);
  });
};

export const listDeclaredPackCollectionRecords = async (
  packId: string,
  collectionKey: string
): Promise<PackCollectionRecord[]> => {
  const location = resolvePackRuntimeDatabaseLocation(packId);
  if (!fs.existsSync(location.runtimeDbPath)) {
    logger.warn(`runtime db missing while listing pack=${packId} path=${location.runtimeDbPath}`);
    return [];
  }

  const collection = readCollectionDefinition(location.runtimeDbPath, collectionKey);
  if (!collection) {
    logger.warn(`collection declaration missing while listing pack=${packId} collection=${collectionKey} path=${location.runtimeDbPath}`);
    return [];
  }

  return withRuntimeDatabase(location.runtimeDbPath, db => {
    db.prepare(buildCreateTableStatement(collection)).run();
    for (const statement of buildCreateIndexStatements(collection)) {
      db.prepare(statement).run();
    }
    const rows = db.prepare(`SELECT * FROM ${collection.key} ORDER BY ${collection.primary_key} ASC`).all() as SqliteRow[];
    return rows.map(row => decodeRowForCollection(collection, row));
  });
};
