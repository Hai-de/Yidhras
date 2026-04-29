import { z } from 'zod';

const PositiveIntSchema = z.number().int().positive();

export const SqliteSubConfigSchema = z
  .object({
    busy_timeout_ms: PositiveIntSchema,
    wal_autocheckpoint_pages: PositiveIntSchema,
    synchronous: z.enum(['OFF', 'NORMAL', 'FULL', 'EXTRA'])
  })
  .strict();

export type SqliteSubConfig = z.infer<typeof SqliteSubConfigSchema>;

export const PostgresSubConfigSchema = z
  .object({
    connection_timeout_ms: PositiveIntSchema,
    ssl: z.boolean()
  })
  .strict();

export const DatabaseConfigSchema = z
  .object({
    provider: z.enum(['sqlite', 'postgresql']).default('sqlite'),
    sqlite: SqliteSubConfigSchema.optional(),
    postgresql: PostgresSubConfigSchema.optional()
  })
  .strict();

export type DatabaseConfig = z.infer<typeof DatabaseConfigSchema>;

export const DATABASE_DEFAULTS: DatabaseConfig = {
  provider: 'sqlite',
  sqlite: {
    busy_timeout_ms: 5000,
    wal_autocheckpoint_pages: 1000,
    synchronous: 'NORMAL'
  }
};
