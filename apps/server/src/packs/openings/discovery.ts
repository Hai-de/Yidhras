import path from 'path';
import * as YAML from 'yaml';

import { safeFs } from '../../utils/safe_fs.js';

export interface OpeningSummary {
  id: string;
  name?: string;
  description?: string;
}

const OPENINGS_DIR = 'openings';
const YAML_EXTENSIONS = ['.yaml', '.yml'];

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
};

export const listPackOpenings = (packDir: string): OpeningSummary[] => {
  const openingsDir = path.join(packDir, OPENINGS_DIR);

  if (!safeFs.existsSync(packDir, openingsDir) || !safeFs.statSync(packDir, openingsDir).isDirectory()) {
    return [];
  }

  const entries = safeFs.readdirSync(packDir, openingsDir, { withFileTypes: true });
  const results: OpeningSummary[] = [];

  for (const entry of entries) {
    if (!entry.isFile()) {
      continue;
    }

    const ext = path.extname(entry.name).toLowerCase();
    if (!YAML_EXTENSIONS.includes(ext)) {
      continue;
    }

    const id = path.basename(entry.name, ext);
    const filePath = path.join(openingsDir, entry.name);

    try {
      const content = safeFs.readFileSync(packDir, filePath, 'utf-8');
      const parsed = YAML.parse(content) as Record<string, unknown>;
      if (isRecord(parsed)) {
        results.push({
          id,
          name: typeof parsed.name === 'string' ? parsed.name : undefined,
          description: typeof parsed.description === 'string' ? parsed.description : undefined
        });
      } else {
        results.push({ id });
      }
    } catch {
      results.push({ id });
    }
  }

  return results;
};
