import { z } from 'zod';

const PositiveIntSchema = z.number().int().positive();
const SqliteSynchronousSchema = z.enum(['OFF', 'NORMAL', 'FULL', 'EXTRA']);

export const SqliteConfigSchema = z
  .object({
    busy_timeout_ms: PositiveIntSchema,
    wal_autocheckpoint_pages: PositiveIntSchema,
    synchronous: SqliteSynchronousSchema
  })
  .strict();

export type SqliteConfig = z.infer<typeof SqliteConfigSchema>;

export const SQLITE_DEFAULTS: SqliteConfig = {
  busy_timeout_ms: 5000,
  wal_autocheckpoint_pages: 1000,
  synchronous: 'NORMAL'
};
