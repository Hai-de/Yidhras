import fs from 'fs';

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

export const asMutablePlanRecord = (storagePlan: PersistedStoragePlan): Record<string, unknown> => {
  return storagePlan as unknown as Record<string, unknown>;
};

export const readPersistedStoragePlan = (storagePlanPath: string): PersistedStoragePlan | null => {
  if (!fs.existsSync(storagePlanPath)) {
    return null;
  }
  const content = fs.readFileSync(storagePlanPath, 'utf-8').trim();
  if (content.length === 0) {
    return null;
  }
  return JSON.parse(content) as PersistedStoragePlan;
};

export const writePersistedStoragePlan = (
  storagePlanPath: string,
  storagePlan: PersistedStoragePlan
): void => {
  fs.writeFileSync(storagePlanPath, stringifyJsonSafe(storagePlan), 'utf-8');
};
