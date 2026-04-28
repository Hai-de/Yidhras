import fs from 'fs';
import path from 'path';
import * as YAML from 'yaml';
import { fromError } from 'zod-validation-error';

import type { WorldPackOpening } from '../schema/constitution_schema.js';
import { worldPackOpeningSchema } from '../schema/constitution_schema.js';

const OPENINGS_DIR = 'openings';
const YAML_EXTENSIONS = ['.yaml', '.yml'];

export const loadPackOpening = (packDir: string, openingId: string): WorldPackOpening => {
  let filePath: string | null = null;

  for (const ext of YAML_EXTENSIONS) {
    const candidate = path.join(packDir, OPENINGS_DIR, `${openingId}${ext}`);
    if (fs.existsSync(candidate)) {
      filePath = candidate;
      break;
    }
  }

  if (!filePath) {
    throw new Error(`[OpeningLoader] Opening "${openingId}" not found in pack: ${packDir}`);
  }

  const content = fs.readFileSync(filePath, 'utf-8');
  const parsed = YAML.parse(content);

  const result = worldPackOpeningSchema.safeParse(parsed);
  if (!result.success) {
    const validationError = fromError(result.error);
    throw new Error(`[OpeningLoader] Invalid opening "${openingId}" (${filePath}): ${validationError.message}`);
  }

  return result.data;
};
