export type PackStorageBackend = 'sqlite' | 'postgresql';

export type CollectionFieldType = 'number' | 'boolean' | 'string' | 'json' | 'timestamp';

export interface CollectionFieldDefinition {
  name: string;
  type: CollectionFieldType;
  required?: boolean;
}

export interface CollectionDefinition {
  key: string;
  kind: string;
  primary_key: string;
  fields: CollectionFieldDefinition[];
  indexes?: Array<{ columns: string[] }>;
}

export interface PackStorageAdapter {
  readonly backend: PackStorageBackend;

  // Schema management
  ensureEngineOwnedSchema(packId: string): Promise<void>;
  ensureCollection(packId: string, collection: CollectionDefinition): Promise<void>;

  // Engine-owned records (5 fixed tables + projection_events)
  listEngineOwnedRecords<T = Record<string, unknown>>(packId: string, tableName: string): Promise<T[]>;
  upsertEngineOwnedRecord<T = Record<string, unknown>>(packId: string, tableName: string, record: T): Promise<T>;

  // Dynamic collections (user-declared per-pack tables)
  upsertCollectionRecord(packId: string, collectionKey: string, record: Record<string, unknown>): Promise<Record<string, unknown> | null>;
  listCollectionRecords(packId: string, collectionKey: string): Promise<Record<string, unknown>[]>;

  // Lifecycle
  destroyPackStorage(packId: string): Promise<void>;

  // Snapshot support
  exportPackData(packId: string): Promise<Record<string, unknown[]>>;
  importPackData(packId: string, data: Record<string, unknown[]>): Promise<void>;

  // Health
  ping(packId: string): Promise<boolean>;
}
