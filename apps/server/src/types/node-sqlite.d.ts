declare module 'node:sqlite' {
  export type SqliteSyncParameter = string | number | bigint | Uint8Array | null;

  export interface StatementSync {
    run(...parameters: SqliteSyncParameter[]): unknown;
    get(...parameters: SqliteSyncParameter[]): Record<string, unknown> | undefined;
    all(...parameters: SqliteSyncParameter[]): Record<string, unknown>[];
  }

  export class DatabaseSync {
    constructor(path?: string, options?: Record<string, unknown>);
    exec(sql: string): void;
    close(): void;
    prepare(sql: string): StatementSync;
  }
}
