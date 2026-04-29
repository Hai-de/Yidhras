import { safeFs } from '../../../utils/safe_fs.js';
import { stringifyJsonSafe } from './json.js';

export interface PersistedStoragePlan {
  strategy: string;
  runtime_db_file: string;
  engine_owned_collections: string[];
  pack_collections: Array<{
    key: string;
    kind: string;
    primary_key: string;
    fields: Array<{
      key: string;
      type: string;
      required?: boolean;
      values?: string[];
    }>;
    indexes: string[][];
  }>;
  projections: Array<Record<string, unknown>>;
  install: Record<string, unknown>;
}
export const readPersistedStoragePlan = (baseDir: string, storagePlanPath: string): PersistedStoragePlan | null => {
  if (!safeFs.existsSync(baseDir, storagePlanPath)) {
    return null;
  }
  const content = safeFs.readFileSync(baseDir, storagePlanPath, 'utf-8').trim();
  if (content.length === 0) {
    return null;
  }
  return JSON.parse(content) as PersistedStoragePlan;
};

export const writePersistedStoragePlan = (
  baseDir: string,
  storagePlanPath: string,
  storagePlan: PersistedStoragePlan
): void => {
  safeFs.writeFileSync(baseDir, storagePlanPath, stringifyJsonSafe(storagePlan));
};
