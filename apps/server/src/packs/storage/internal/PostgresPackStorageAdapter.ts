import type { PrismaClient } from '@prisma/client';

import type {
  CollectionDefinition,
  CollectionFieldDefinition,
  PackStorageAdapter,
  PackStorageBackend
} from '../PackStorageAdapter.js';

const ENGINE_OWNED_TABLE_NAMES = [
  'world_entities',
  'entity_states',
  'authority_grants',
  'mediator_bindings',
  'rule_execution_records',
  'projection_events'
] as const;

interface EngineOwnedTableDef {
  name: string;
  ddl: string[];
  indexes: string[];
  columns: string[];
  primaryKey: string;
}

// ENGINE_OWNED_TABLE_DEFS: adapted from sqlite_engine_owned_store.ts DDL.
// REAL → DOUBLE PRECISION, everything else unchanged.
const ENGINE_OWNED_TABLE_DEFS: EngineOwnedTableDef[] = [
  {
    name: 'world_entities',
    ddl: [
      `id TEXT PRIMARY KEY,
       pack_id TEXT NOT NULL,
       entity_kind TEXT NOT NULL,
       entity_type TEXT,
       label TEXT NOT NULL,
       tags_json TEXT NOT NULL,
       static_schema_ref TEXT,
       payload_json TEXT,
       created_at TEXT NOT NULL,
       updated_at TEXT NOT NULL`
    ],
    indexes: ['idx_world_entities_pack_id ON world_entities (pack_id)'],
    columns: ['id', 'pack_id', 'entity_kind', 'entity_type', 'label', 'tags_json', 'static_schema_ref', 'payload_json', 'created_at', 'updated_at'],
    primaryKey: 'id'
  },
  {
    name: 'entity_states',
    ddl: [
      `id TEXT PRIMARY KEY,
       pack_id TEXT NOT NULL,
       entity_id TEXT NOT NULL,
       state_namespace TEXT NOT NULL,
       state_json TEXT NOT NULL,
       created_at TEXT NOT NULL,
       updated_at TEXT NOT NULL`
    ],
    indexes: [
      'idx_entity_states_pack_id ON entity_states (pack_id)',
      'idx_entity_states_pack_entity_namespace ON entity_states (pack_id, entity_id, state_namespace)'
    ],
    columns: ['id', 'pack_id', 'entity_id', 'state_namespace', 'state_json', 'created_at', 'updated_at'],
    primaryKey: 'id'
  },
  {
    name: 'authority_grants',
    ddl: [
      `id TEXT PRIMARY KEY,
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
       updated_at TEXT NOT NULL`
    ],
    indexes: [
      'idx_authority_grants_pack_id ON authority_grants (pack_id)',
      'idx_authority_grants_pack_capability ON authority_grants (pack_id, capability_key)'
    ],
    columns: ['id', 'pack_id', 'source_entity_id', 'target_selector_json', 'capability_key', 'grant_type', 'mediated_by_entity_id', 'scope_json', 'conditions_json', 'priority', 'status', 'revocable', 'created_at', 'updated_at'],
    primaryKey: 'id'
  },
  {
    name: 'mediator_bindings',
    ddl: [
      `id TEXT PRIMARY KEY,
       pack_id TEXT NOT NULL,
       mediator_id TEXT NOT NULL,
       subject_entity_id TEXT,
       binding_kind TEXT NOT NULL,
       status TEXT NOT NULL,
       metadata_json TEXT,
       created_at TEXT NOT NULL,
       updated_at TEXT NOT NULL`
    ],
    indexes: [
      'idx_mediator_bindings_pack_id ON mediator_bindings (pack_id)',
      'idx_mediator_bindings_pack_mediator ON mediator_bindings (pack_id, mediator_id)'
    ],
    columns: ['id', 'pack_id', 'mediator_id', 'subject_entity_id', 'binding_kind', 'status', 'metadata_json', 'created_at', 'updated_at'],
    primaryKey: 'id'
  },
  {
    name: 'rule_execution_records',
    ddl: [
      `id TEXT PRIMARY KEY,
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
       updated_at TEXT NOT NULL`
    ],
    indexes: [
      'idx_rule_execution_records_pack_id ON rule_execution_records (pack_id)',
      'idx_rule_execution_records_pack_status ON rule_execution_records (pack_id, execution_status)'
    ],
    columns: ['id', 'pack_id', 'rule_id', 'capability_key', 'mediator_id', 'subject_entity_id', 'target_entity_id', 'execution_status', 'payload_json', 'emitted_events_json', 'created_at', 'updated_at'],
    primaryKey: 'id'
  },
  {
    name: 'projection_events',
    ddl: [
      `id TEXT PRIMARY KEY,
       pack_id TEXT NOT NULL,
       projection_key TEXT,
       payload_json TEXT,
       created_at TEXT NOT NULL,
       updated_at TEXT NOT NULL`
    ],
    indexes: ['idx_projection_events_pack_id ON projection_events (pack_id)'],
    columns: ['id', 'pack_id', 'projection_key', 'payload_json', 'created_at', 'updated_at'],
    primaryKey: 'id'
  }
];

const TABLE_DEF_BY_NAME = new Map<string, EngineOwnedTableDef>(
  ENGINE_OWNED_TABLE_DEFS.map(def => [def.name, def])
);

function mapFieldTypeToPgType(fieldType: string): string {
  switch (fieldType) {
    case 'number':
      return 'DOUBLE PRECISION';
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
}

function encodeFieldValue(field: CollectionFieldDefinition, value: unknown): string | number | null {
  if (value === undefined || value === null) {
    return null;
  }
  switch (field.type) {
    case 'number':
      return typeof value === 'number' && Number.isFinite(value) ? value : Number(value);
    case 'boolean':
      return value === true ? 1 : 0;
    case 'json':
      return JSON.stringify(value);
    case 'timestamp':
    case 'string':
    default:
      return String(value);
  }
}

function decodeFieldValue(field: CollectionFieldDefinition, value: unknown): unknown {
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
        try { return JSON.parse(value) as unknown; } catch { return null; }
      }
      return value;
    }
    default:
      return typeof value === 'string' ? value : String(value);
  }
}

function toBigIntValue(value: unknown): bigint {
  if (typeof value === 'bigint') return value;
  return BigInt(String(value));
}

function toNullableBooleanValue(value: unknown): boolean | null {
  if (value === null || value === undefined) return null;
  return value === 1 || value === '1' || value === true;
}

function parseJsonValue(value: unknown): Record<string, unknown> | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>;
  if (typeof value === 'string') {
    try { return JSON.parse(value) as Record<string, unknown>; } catch { return null; }
  }
  return null;
}

function parseJsonArrayValue(value: unknown): unknown[] {
  if (Array.isArray(value)) return value as unknown[];
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value) as unknown;
      return Array.isArray(parsed) ? parsed : [];
    } catch { return []; }
  }
  return [];
}

function parseStringArrayValue(value: unknown): string[] {
  return parseJsonArrayValue(value).map(v => String(v));
}

function decodeEngineOwnedRow(tableName: string, row: Record<string, unknown>): Record<string, unknown> {
  const decoded: Record<string, unknown> = {};

  const scope = ['authority_grants', 'mediator_bindings', 'rule_execution_records'].includes(tableName);

  for (const [key, value] of Object.entries(row)) {
    if (key === 'created_at' || key === 'updated_at' || key === 'completed_at' || key === 'acquired_at' || key === 'expires_at' ||
        key === 'locked_at' || key === 'lock_expires_at' || key === 'dispatch_started_at' || key === 'dispatched_at' ||
        key === 'scheduled_after_ticks' || key === 'scheduled_for_tick' || key === 'created_at_tick' || key === 'updated_at_tick' ||
        key === 'bound_at' || key === 'imported_at' || key === 'confirmed_at' || key === 'enabled_at' || key === 'disabled_at' ||
        key === 'started_at' || key === 'finished_at' || key === 'last_heartbeat_at') {
      decoded[key] = value !== null && value !== undefined ? toBigIntValue(value) : null;
    } else if (scope && key === 'priority') {
      decoded[key] = typeof value === 'number' ? value : Number(value);
    } else if (scope && key === 'revocable') {
      decoded[key] = toNullableBooleanValue(value);
    } else if (key === 'tags' || (scope && key === 'target_selector_json')) {
      decoded[key] = parseJsonValue(value) ?? (key === 'tags' ? [] : {});
    } else if (key === 'tags_json') {
      decoded[key] = parseStringArrayValue(value);
    } else if (key === 'payload_json' || key === 'state_json' || key === 'scope_json' || key === 'conditions_json' ||
               key === 'metadata_json' || key === 'impact_data' || key === 'details' || key === 'summary' ||
               key === 'request_input' || key === 'behavior_json' || key === 'content_structured' || key === 'source_ref' ||
               key === 'context_snapshot' || key === 'prompt_bundle' || key === 'trace_metadata' || key === 'decision' ||
               key === 'actor_ref' || key === 'target_ref' || key === 'input' || key === 'claims' || key === 'manifest_json' ||
               key === 'attempted_models_json' || key === 'usage_json' || key === 'safety_json' || key === 'request_json' ||
               key === 'response_json' || key === 'detail_json' || key === 'candidate_reasons' || key === 'replay_override_snapshot' ||
               key === 'emitted_events_json') {
      decoded[key] = parseJsonValue(value);
    } else {
      decoded[key] = value;
    }
  }

  return decoded;
}

export class PostgresPackStorageAdapter implements PackStorageAdapter {
  readonly backend: PackStorageBackend = 'postgresql';

  private readonly collectionDefs = new Map<string, CollectionDefinition>();

  constructor(private readonly prisma: PrismaClient) {}

  private schemaName(packId: string): string {
    return `pack_${packId.replace(/[^a-zA-Z0-9_]/g, '_').toLowerCase()}`;
  }

  private qualifiedName(packId: string, tableName: string): string {
    return `${this.schemaName(packId)}."${tableName}"`;
  }

  private collectionKey(packId: string, collectionKey: string): string {
    return `${packId}::${collectionKey}`;
  }

  // -- Schema --

  async ensureEngineOwnedSchema(packId: string): Promise<void> {
    const schema = this.schemaName(packId);
    await this.prisma.$executeRawUnsafe(`CREATE SCHEMA IF NOT EXISTS ${schema}`);

    for (const def of ENGINE_OWNED_TABLE_DEFS) {
      const tableName = this.qualifiedName(packId, def.name);
      const ddl = `CREATE TABLE IF NOT EXISTS ${tableName} (\n        ${def.ddl}\n      )`;
      await this.prisma.$executeRawUnsafe(ddl);

      for (const idx of def.indexes) {
        const idxParts = idx.split(' ON ');
        const idxName = idxParts[0];
        const idxTarget = idxParts[1];
        await this.prisma.$executeRawUnsafe(
          `CREATE INDEX IF NOT EXISTS ${idxName} ON ${tableName.split('.')[0]}."${def.name}" (${idxTarget.replace(/^.*\(/, '').replace(/\)$/, '')})`
        );
      }
    }
  }

  async ensureCollection(packId: string, collection: CollectionDefinition): Promise<void> {
    this.collectionDefs.set(this.collectionKey(packId, collection.key), collection);

    const tableName = this.qualifiedName(packId, collection.key);
    const columns = collection.fields.map(f => {
      const parts = [`"${f.name}" ${mapFieldTypeToPgType(f.type)}`];
      if (f.name === collection.primary_key) parts.push('PRIMARY KEY');
      if (f.required === true) parts.push('NOT NULL');
      return parts.join(' ');
    }).join(',\n        ');

    await this.prisma.$executeRawUnsafe(
      `CREATE TABLE IF NOT EXISTS ${tableName} (\n        ${columns}\n      )`
    );

    if (collection.indexes) {
      for (const idx of collection.indexes) {
        const colList = idx.columns.map(c => `"${c}"`).join(', ');
        await this.prisma.$executeRawUnsafe(
          `CREATE INDEX IF NOT EXISTS idx_${collection.key}_${idx.columns.join('_')} ON ${tableName} (${colList})`
        );
      }
    }
  }

  // -- Engine-owned records --

  async listEngineOwnedRecords<T = Record<string, unknown>>(packId: string, tableName: string): Promise<T[]> {
    const tableDef = TABLE_DEF_BY_NAME.get(tableName);
    if (!tableDef) {
      return [];
    }

    const table = this.qualifiedName(packId, tableName);
    try {
      const rows = await this.prisma.$queryRawUnsafe<Record<string, unknown>[]>(
        `SELECT * FROM ${table} WHERE pack_id = $1 ORDER BY created_at ASC, id ASC`,
        packId
      );
      return rows.map(row => decodeEngineOwnedRow(tableName, row)) as T[];
    } catch {
      return [];
    }
  }

  async upsertEngineOwnedRecord<T = Record<string, unknown>>(packId: string, tableName: string, record: T): Promise<T> {
    const tableDef = TABLE_DEF_BY_NAME.get(tableName);
    if (!tableDef) {
      throw new Error(`[PostgresPackStorageAdapter] unknown engine-owned table: ${tableName}`);
    }

    // Preserve original created_at if the row already exists
    const rec = record as Record<string, unknown>;
    let origCreatedAt: unknown = rec['created_at'];
    try {
      const table = this.qualifiedName(packId, tableName);
      const existingRows = await this.prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(
        `SELECT created_at FROM ${table} WHERE id = $1`,
        rec['id'] as string
      );
      if (existingRows.length > 0) {
        const existing = existingRows[0] as Record<string, unknown>;
        if (existing['created_at'] !== null) {
          origCreatedAt = existing['created_at'];
        }
      }
    } catch {
      // Table may not exist yet; use provided created_at
    }

    const upsertRecord: Record<string, unknown> = { ...rec, created_at: origCreatedAt ?? rec['created_at'] };
    const columns = tableDef.columns.filter(c => c in upsertRecord || c === tableDef.primaryKey);
    const values = columns.map((_, i) => `$${String(i + 1)}`);
    const assignments = columns
      .filter(c => c !== tableDef.primaryKey)
      .map(c => `"${c}" = EXCLUDED."${c}"`)
      .join(', ');

    const table = this.qualifiedName(packId, tableName);
    const sql = assignments.length > 0
      ? `INSERT INTO ${table} (${columns.map(c => `"${c}"`).join(', ')}) VALUES (${values.join(', ')}) ON CONFLICT("${tableDef.primaryKey}") DO UPDATE SET ${assignments}`
      : `INSERT INTO ${table} (${columns.map(c => `"${c}"`).join(', ')}) VALUES (${values.join(', ')}) ON CONFLICT DO NOTHING`;

    const params = columns.map(c => {
      const val = upsertRecord[c];
      if (c === 'tags_json' || c === 'target_selector_json' || c === 'payload_json' || c === 'state_json' ||
          c === 'scope_json' || c === 'conditions_json' || c === 'metadata_json' || c === 'emitted_events_json') {
        return typeof val === 'string' ? val : JSON.stringify(val);
      }
      if (c === 'tags' && Array.isArray(val)) {
        return JSON.stringify(val);
      }
      return val ?? null;
    });

    await this.prisma.$executeRawUnsafe(sql, ...params);

    return upsertRecord as T;
  }

  // -- Dynamic collections --

  async upsertCollectionRecord(packId: string, collectionKey: string, record: Record<string, unknown>): Promise<Record<string, unknown> | null> {
    const collection = this.collectionDefs.get(this.collectionKey(packId, collectionKey));
    if (!collection) {
      return null;
    }

    const table = this.qualifiedName(packId, collectionKey);
    const encoded = Object.fromEntries(
      collection.fields.map(f => [f.name, encodeFieldValue(f, record[f.name])])
    );

    const pkVal = encoded[collection.primary_key];
    if (pkVal === null || pkVal === undefined || String(pkVal).trim().length === 0) {
      return null;
    }

    for (const f of collection.fields) {
      if (f.required === true && encoded[f.name] === null) {
        return null;
      }
    }

    const columns = collection.fields.map(f => `"${f.name}"`);
    const values = columns.map((_, i) => `$${String(i + 1)}`);
    const assignments = collection.fields
      .filter(f => f.name !== collection.primary_key)
      .map(f => `"${f.name}" = EXCLUDED."${f.name}"`)
      .join(', ');

    const sql = assignments.length > 0
      ? `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${values.join(', ')}) ON CONFLICT("${collection.primary_key}") DO UPDATE SET ${assignments}`
      : `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${values.join(', ')}) ON CONFLICT DO NOTHING`;

    const params = collection.fields.map(f => encoded[f.name] ?? null);

    await this.prisma.$executeRawUnsafe(sql, ...params);

    return Object.fromEntries(
      collection.fields.map(f => [f.name, decodeFieldValue(f, encoded[f.name])])
    );
  }

  async listCollectionRecords(packId: string, collectionKey: string): Promise<Record<string, unknown>[]> {
    const collection = this.collectionDefs.get(this.collectionKey(packId, collectionKey));
    if (!collection) {
      return [];
    }

    const table = this.qualifiedName(packId, collectionKey);
    try {
      const rows = await this.prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(
        `SELECT * FROM ${table} ORDER BY "${collection.primary_key}" ASC`
      );
      return rows.map(row =>
        Object.fromEntries(
          collection.fields.map(f => [f.name, decodeFieldValue(f, row[f.name])])
        )
      );
    } catch {
      return [];
    }
  }

  // -- Lifecycle --

  async destroyPackStorage(packId: string): Promise<void> {
    const schema = this.schemaName(packId);
    await this.prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    // Clear cached collection defs for this pack
    for (const key of this.collectionDefs.keys()) {
      if (key.startsWith(`${packId}::`)) {
        this.collectionDefs.delete(key);
      }
    }
  }

  // -- Snapshot support --

  async exportPackData(packId: string): Promise<Record<string, unknown[]>> {
    const result: Record<string, unknown[]> = {};

    for (const def of ENGINE_OWNED_TABLE_DEFS) {
      if (def.name === 'projection_events') {
        continue;
      }
      result[def.name] = await this.listEngineOwnedRecords(packId, def.name);
    }

    for (const [key, collection] of this.collectionDefs) {
      if (key.startsWith(`${packId}::`)) {
        result[collection.key] = await this.listCollectionRecords(packId, collection.key);
      }
    }

    return result;
  }

  async importPackData(packId: string, data: Record<string, unknown[]>): Promise<void> {
    await this.ensureEngineOwnedSchema(packId);

    for (const [tableName, rows] of Object.entries(data)) {
      if (ENGINE_OWNED_TABLE_NAMES.includes(tableName as typeof ENGINE_OWNED_TABLE_NAMES[number]) && tableName !== 'projection_events') {
        for (const row of rows) {
          await this.upsertEngineOwnedRecord(packId, tableName, row);
        }
      } else {
        for (const row of rows) {
          await this.upsertCollectionRecord(packId, tableName, row as Record<string, unknown>);
        }
      }
    }
  }

  // -- Health --

  async ping(packId: string): Promise<boolean> {
    try {
      const schema = this.schemaName(packId);
      const rows = await this.prisma.$queryRawUnsafe<Array<{ exists: boolean }>>(
        `SELECT EXISTS (SELECT 1 FROM information_schema.schemata WHERE schema_name = $1)`,
        schema
      );
      return rows.length > 0 && rows[0].exists === true;
    } catch {
      return false;
    }
  }
}
