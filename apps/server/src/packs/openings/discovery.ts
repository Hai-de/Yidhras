import fs from 'fs';
import path from 'path';
import * as YAML from 'yaml';

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

  if (!fs.existsSync(openingsDir) || !fs.statSync(openingsDir).isDirectory()) {
    return [];
  }

  const entries = fs.readdirSync(openingsDir, { withFileTypes: true });
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
      const content = fs.readFileSync(filePath, 'utf-8');
      const parsed = YAML.parse(content);
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
