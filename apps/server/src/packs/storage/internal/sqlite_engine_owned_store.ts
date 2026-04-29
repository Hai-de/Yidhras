import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { safeFs } from '../../../utils/safe_fs.js';
import type {
  PackRuntimeAuthorityGrantRecord,
  PackRuntimeEntityStateRecord,
  PackRuntimeMediatorBindingRecord,
  PackRuntimeRuleExecutionRecord,
  PackRuntimeWorldEntityRecord
} from '../../runtime/core_models.js';
import { stringifyJsonSafe } from './json.js';

type SqlitePrimitive = string | number | null;
type SqliteRow = Record<string, unknown>;
type SqliteDatabase = DatabaseSync;

export interface SqliteEngineOwnedTableSpec<RecordT> {
  tableName: string;
  createStatements: string[];
  encode(record: RecordT): Record<string, SqlitePrimitive>;
  decode(row: SqliteRow): RecordT;
}

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
};

const parseJsonString = (value: string): unknown => {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return undefined;
  }
};

const parseRecordValue = (value: unknown, fallback: Record<string, unknown> = {}): Record<string, unknown> => {
  if (isRecord(value)) {
    return value;
  }
  if (typeof value === 'string') {
    const parsed = parseJsonString(value);
    if (isRecord(parsed)) {
      return parsed;
    }
  }
  return fallback;
};

const parseNullableRecordValue = (value: unknown): Record<string, unknown> | null => {
  if (value === null || value === undefined) {
    return null;
  }
  if (isRecord(value)) {
    return value;
  }
  if (typeof value === 'string') {
    const parsed = parseJsonString(value);
    if (isRecord(parsed)) {
      return parsed;
    }
  }
  return null;
};

const parseStringArrayValue = (value: unknown): string[] => {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === 'string');
  }
  if (typeof value === 'string') {
    const parsed = parseJsonString(value);
    if (Array.isArray(parsed)) {
      return parsed.filter((item): item is string => typeof item === 'string');
    }
  }
  return [];
};

const parseUnknownArrayValue = (value: unknown): unknown[] => {
  if (Array.isArray(value)) {
    return value;
  }
  if (typeof value === 'string') {
    const parsed = parseJsonString(value);
    if (Array.isArray(parsed)) {
      return parsed;
    }
  }
  return [];
};

const toNullableString = (value: unknown): string | null => {
  if (typeof value === 'string') {
    return value;
  }
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === 'object') {
    return JSON.stringify(value) ?? null;
  }
  return String(value as string | number | boolean | bigint | symbol | undefined);
};

const toBigInt = (value: unknown): bigint => {
  if (typeof value === 'bigint') {
    return value;
  }
  if (typeof value === 'number') {
    return BigInt(Math.trunc(value));
  }
  if (typeof value === 'string' && value.trim().length > 0) {
    return BigInt(value);
  }
  return 0n;
};

const toNullableBoolean = (value: unknown): boolean | null => {
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'number') {
    if (value === 1) {
      return true;
    }
    if (value === 0) {
      return false;
    }
  }
  if (typeof value === 'string') {
    if (value === '1' || value.toLowerCase() === 'true') {
      return true;
    }
    if (value === '0' || value.toLowerCase() === 'false') {
      return false;
    }
  }
  return null;
};

const encodeNullableBoolean = (value: boolean | null): SqlitePrimitive => {
  if (value === null) {
    return null;
  }
  return value ? 1 : 0;
};

const openDatabase = (runtimeDbPath: string): SqliteDatabase => {
  return new DatabaseSync(runtimeDbPath);
};

const closeDatabase = (db: SqliteDatabase): void => {
  db.close();
};

const runStatement = (db: SqliteDatabase, sql: string, params: SqlitePrimitive[] = []): void => {
  db.prepare(sql).run(...params);
};

const getStatement = <T extends SqliteRow>(
  db: SqliteDatabase,
  sql: string,
  params: SqlitePrimitive[] = []
): T | null => {
  return (db.prepare(sql).get(...params) as T | undefined) ?? null;
};

const allStatement = <T extends SqliteRow>(
  db: SqliteDatabase,
  sql: string,
  params: SqlitePrimitive[] = []
): T[] => {
  return (db.prepare(sql).all(...params) as T[] | undefined) ?? [];
};
const withRuntimeDatabase = async <T>(
  runtimeDbPath: string,
  handler: (db: SqliteDatabase) => Promise<T> | T
): Promise<T> => {
  const db = openDatabase(runtimeDbPath);
  try {
    return await handler(db);
  } finally {
    closeDatabase(db);
  }
};

export const packRuntimeWorldEntityTableSpec: SqliteEngineOwnedTableSpec<PackRuntimeWorldEntityRecord> = {
  tableName: 'world_entities',
  createStatements: [
    `CREATE TABLE IF NOT EXISTS world_entities (
      id TEXT PRIMARY KEY,
      pack_id TEXT NOT NULL,
      entity_kind TEXT NOT NULL,
      entity_type TEXT,
      label TEXT NOT NULL,
      tags_json TEXT NOT NULL,
      static_schema_ref TEXT,
      payload_json TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`,
    'CREATE INDEX IF NOT EXISTS idx_world_entities_pack_id ON world_entities (pack_id)'
  ],
  encode(record) {
    return {
      id: record.id,
      pack_id: record.pack_id,
      entity_kind: record.entity_kind,
      entity_type: record.entity_type,
      label: record.label,
      tags_json: stringifyJsonSafe(record.tags),
      static_schema_ref: record.static_schema_ref,
      payload_json: record.payload_json ? stringifyJsonSafe(record.payload_json) : null,
      created_at: record.created_at.toString(),
      updated_at: record.updated_at.toString()
    };
  },
  decode(row) {
    return {
      id: String(row.id as string),
      pack_id: String(row.pack_id as string),
      entity_kind: String(row.entity_kind as string),
      entity_type: toNullableString(row.entity_type),
      label: String(row.label as string),
      tags: parseStringArrayValue(row.tags_json ?? row.tags),
      static_schema_ref: toNullableString(row.static_schema_ref),
      payload_json: parseNullableRecordValue(row.payload_json),
      created_at: toBigInt(row.created_at),
      updated_at: toBigInt(row.updated_at)
    };
  }
};

export const packRuntimeEntityStateTableSpec: SqliteEngineOwnedTableSpec<PackRuntimeEntityStateRecord> = {
  tableName: 'entity_states',
  createStatements: [
    `CREATE TABLE IF NOT EXISTS entity_states (
      id TEXT PRIMARY KEY,
      pack_id TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      state_namespace TEXT NOT NULL,
      state_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`,
    'CREATE INDEX IF NOT EXISTS idx_entity_states_pack_id ON entity_states (pack_id)',
    'CREATE INDEX IF NOT EXISTS idx_entity_states_pack_entity_namespace ON entity_states (pack_id, entity_id, state_namespace)'
  ],
  encode(record) {
    return {
      id: record.id,
      pack_id: record.pack_id,
      entity_id: record.entity_id,
      state_namespace: record.state_namespace,
      state_json: stringifyJsonSafe(record.state_json),
      created_at: record.created_at.toString(),
      updated_at: record.updated_at.toString()
    };
  },
  decode(row) {
    return {
      id: String(row.id as string),
      pack_id: String(row.pack_id as string),
      entity_id: String(row.entity_id as string),
      state_namespace: String(row.state_namespace as string),
      state_json: parseRecordValue(row.state_json),
      created_at: toBigInt(row.created_at),
      updated_at: toBigInt(row.updated_at)
    };
  }
};

export const packRuntimeAuthorityGrantTableSpec: SqliteEngineOwnedTableSpec<PackRuntimeAuthorityGrantRecord> = {
  tableName: 'authority_grants',
  createStatements: [
    `CREATE TABLE IF NOT EXISTS authority_grants (
      id TEXT PRIMARY KEY,
      pack_id TEXT NOT NULL,
      source_entity_id TEXT NOT NULL,
      target_selector_json TEXT NOT NULL,
      capability_key TEXT NOT NULL,
      grant_type TEXT NOT NULL,
      mediated_by_entity_id TEXT,
      scope_json TEXT,
      conditions_json TEXT,
      priority INTEGER NOT NULL,
      status TEXT,
      revocable INTEGER,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`,
    'CREATE INDEX IF NOT EXISTS idx_authority_grants_pack_id ON authority_grants (pack_id)',
    'CREATE INDEX IF NOT EXISTS idx_authority_grants_pack_capability ON authority_grants (pack_id, capability_key)'
  ],
  encode(record) {
    return {
      id: record.id,
      pack_id: record.pack_id,
      source_entity_id: record.source_entity_id,
      target_selector_json: stringifyJsonSafe(record.target_selector_json),
      capability_key: record.capability_key,
      grant_type: record.grant_type,
      mediated_by_entity_id: record.mediated_by_entity_id,
      scope_json: record.scope_json ? stringifyJsonSafe(record.scope_json) : null,
      conditions_json: record.conditions_json ? stringifyJsonSafe(record.conditions_json) : null,
      priority: record.priority,
      status: record.status,
      revocable: encodeNullableBoolean(record.revocable),
      created_at: record.created_at.toString(),
      updated_at: record.updated_at.toString()
    };
  },
  decode(row) {
    return {
      id: String(row.id as string),
      pack_id: String(row.pack_id as string),
      source_entity_id: String(row.source_entity_id as string),
      target_selector_json: parseRecordValue(row.target_selector_json),
      capability_key: String(row.capability_key as string),
      grant_type: String(row.grant_type as string),
      mediated_by_entity_id: toNullableString(row.mediated_by_entity_id),
      scope_json: parseNullableRecordValue(row.scope_json),
      conditions_json: parseNullableRecordValue(row.conditions_json),
      priority: Number(row.priority ?? 0),
      status: toNullableString(row.status),
      revocable: toNullableBoolean(row.revocable),
      created_at: toBigInt(row.created_at),
      updated_at: toBigInt(row.updated_at)
    };
  }
};

export const packRuntimeMediatorBindingTableSpec: SqliteEngineOwnedTableSpec<PackRuntimeMediatorBindingRecord> = {
  tableName: 'mediator_bindings',
  createStatements: [
    `CREATE TABLE IF NOT EXISTS mediator_bindings (
      id TEXT PRIMARY KEY,
      pack_id TEXT NOT NULL,
      mediator_id TEXT NOT NULL,
      subject_entity_id TEXT,
      binding_kind TEXT NOT NULL,
      status TEXT NOT NULL,
      metadata_json TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`,
    'CREATE INDEX IF NOT EXISTS idx_mediator_bindings_pack_id ON mediator_bindings (pack_id)',
    'CREATE INDEX IF NOT EXISTS idx_mediator_bindings_pack_mediator ON mediator_bindings (pack_id, mediator_id)'
  ],
  encode(record) {
    return {
      id: record.id,
      pack_id: record.pack_id,
      mediator_id: record.mediator_id,
      subject_entity_id: record.subject_entity_id,
      binding_kind: record.binding_kind,
      status: record.status,
      metadata_json: record.metadata_json ? stringifyJsonSafe(record.metadata_json) : null,
      created_at: record.created_at.toString(),
      updated_at: record.updated_at.toString()
    };
  },
  decode(row) {
    return {
      id: String(row.id as string),
      pack_id: String(row.pack_id as string),
      mediator_id: String(row.mediator_id as string),
      subject_entity_id: toNullableString(row.subject_entity_id),
      binding_kind: String(row.binding_kind as string),
      status: String(row.status as string),
      metadata_json: parseNullableRecordValue(row.metadata_json),
      created_at: toBigInt(row.created_at),
      updated_at: toBigInt(row.updated_at)
    };
  }
};

export const packRuntimeRuleExecutionTableSpec: SqliteEngineOwnedTableSpec<PackRuntimeRuleExecutionRecord> = {
  tableName: 'rule_execution_records',
  createStatements: [
    `CREATE TABLE IF NOT EXISTS rule_execution_records (
      id TEXT PRIMARY KEY,
      pack_id TEXT NOT NULL,
      rule_id TEXT NOT NULL,
      capability_key TEXT,
      mediator_id TEXT,
      subject_entity_id TEXT,
      target_entity_id TEXT,
      execution_status TEXT NOT NULL,
      payload_json TEXT,
      emitted_events_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`,
    'CREATE INDEX IF NOT EXISTS idx_rule_execution_records_pack_id ON rule_execution_records (pack_id)',
    'CREATE INDEX IF NOT EXISTS idx_rule_execution_records_pack_status ON rule_execution_records (pack_id, execution_status)'
  ],
  encode(record) {
    return {
      id: record.id,
      pack_id: record.pack_id,
      rule_id: record.rule_id,
      capability_key: record.capability_key,
      mediator_id: record.mediator_id,
      subject_entity_id: record.subject_entity_id,
      target_entity_id: record.target_entity_id,
      execution_status: record.execution_status,
      payload_json: record.payload_json ? stringifyJsonSafe(record.payload_json) : null,
      emitted_events_json: stringifyJsonSafe(record.emitted_events_json),
      created_at: record.created_at.toString(),
      updated_at: record.updated_at.toString()
    };
  },
  decode(row) {
    return {
      id: String(row.id as string),
      pack_id: String(row.pack_id as string),
      rule_id: String(row.rule_id as string),
      capability_key: toNullableString(row.capability_key),
      mediator_id: toNullableString(row.mediator_id),
      subject_entity_id: toNullableString(row.subject_entity_id),
      target_entity_id: toNullableString(row.target_entity_id),
      execution_status: String(row.execution_status as string),
      payload_json: parseNullableRecordValue(row.payload_json),
      emitted_events_json: parseUnknownArrayValue(row.emitted_events_json),
      created_at: toBigInt(row.created_at),
      updated_at: toBigInt(row.updated_at)
    };
  }
};

const projectionEventCreateStatements = [
  `CREATE TABLE IF NOT EXISTS projection_events (
    id TEXT PRIMARY KEY,
    pack_id TEXT NOT NULL,
    projection_key TEXT,
    payload_json TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  'CREATE INDEX IF NOT EXISTS idx_projection_events_pack_id ON projection_events (pack_id)'
];

const engineOwnedTableSpecs = [
  packRuntimeWorldEntityTableSpec,
  packRuntimeEntityStateTableSpec,
  packRuntimeAuthorityGrantTableSpec,
  packRuntimeMediatorBindingTableSpec,
  packRuntimeRuleExecutionTableSpec
] as const;

export const ENGINE_OWNED_TABLE_NAMES = [
  ...engineOwnedTableSpecs.map(spec => spec.tableName),
  'projection_events'
] as const;

const schemaStatements = [
  ...engineOwnedTableSpecs.flatMap(spec => spec.createStatements),
  ...projectionEventCreateStatements
];

const buildUpsertStatement = (tableName: string, columns: string[]): string => {
  const placeholders = columns.map(() => '?').join(', ');
  const updateAssignments = columns
    .filter(column => column !== 'id')
    .map(column => {
      if (column === 'created_at') {
        return `created_at = ${tableName}.created_at`;
      }
      return `${column} = excluded.${column}`;
    })
    .join(', ');

  return [
    `INSERT INTO ${tableName} (${columns.join(', ')})`,
    `VALUES (${placeholders})`,
    `ON CONFLICT(id) DO UPDATE SET ${updateAssignments}`
  ].join(' ');
};

const applySchema = (db: SqliteDatabase): void => {
  for (const statement of schemaStatements) {
    runStatement(db, statement);
  }
};

export const ensurePackRuntimeSqliteStorage = async (runtimeDbPath: string): Promise<void> => {
  await withRuntimeDatabase(runtimeDbPath, db => {
    applySchema(db);
  });
};

export const listSqliteEngineOwnedRecords = async <RecordT>(
  runtimeDbPath: string,
  spec: SqliteEngineOwnedTableSpec<RecordT>,
  packId: string
): Promise<RecordT[]> => {
  if (!safeFs.existsSync(path.dirname(runtimeDbPath), runtimeDbPath)) {
    return [];
  }

  return withRuntimeDatabase(runtimeDbPath, db => {
    applySchema(db);
    const rows = allStatement<SqliteRow>(
      db,
      `SELECT * FROM ${spec.tableName} WHERE pack_id = ? ORDER BY CAST(created_at AS INTEGER) ASC, id ASC`,
      [packId]
    );
    return rows.map(row => spec.decode(row));
  });
};

export const upsertSqliteEngineOwnedRecord = async <RecordT>(
  runtimeDbPath: string,
  spec: SqliteEngineOwnedTableSpec<RecordT>,
  record: RecordT
): Promise<RecordT> => {
  if (!safeFs.existsSync(path.dirname(runtimeDbPath), runtimeDbPath)) {
    throw new Error(`[sqlite_engine_owned_store] runtime database not found: ${runtimeDbPath}`);
  }

  return withRuntimeDatabase(runtimeDbPath, db => {
    applySchema(db);
    const row = spec.encode(record);
    const existing = getStatement<SqliteRow>(db, `SELECT created_at FROM ${spec.tableName} WHERE id = ?`, [row.id ?? null]);
    if (existing?.created_at !== undefined && existing.created_at !== null) {
      row.created_at = String(existing.created_at as string);
    }
    const columns = Object.keys(row);
// eslint-disable-next-line security/detect-object-injection -- 从内部枚举构造的键
    runStatement(db, buildUpsertStatement(spec.tableName, columns), columns.map(column => row[column] ?? null));
    return spec.decode(row as SqliteRow);
  });
};

export const countSqliteEngineOwnedRecords = async (
  runtimeDbPath: string,
  tableName: string
): Promise<number> => {
  if (!safeFs.existsSync(path.dirname(runtimeDbPath), runtimeDbPath)) {
    return 0;
  }

  return withRuntimeDatabase(runtimeDbPath, db => {
    applySchema(db);
    const row = getStatement<{ count: number | string }>(db, `SELECT COUNT(*) as count FROM ${tableName}`);
    return Number(row?.count ?? 0);
  });
};
