import path from 'path';
import * as YAML from 'yaml';

import { createLogger } from '../../utils/logger.js';
import { safeFs } from '../../utils/safe_fs.js';
import type { WorldPackInclude } from '../schema/constitution_schema.js';
import { VALID_INCLUDE_SECTION_KEYS } from '../schema/constitution_schema.js';

const logger = createLogger('include-resolver');

const VALID_SECTION_KEYS = new Set<string>(VALID_INCLUDE_SECTION_KEYS);

export interface IncludeResolveResult {
  merged: Record<string, unknown>;
  diagnostics: IncludeDiagnostic[];
}

export interface IncludeDiagnostic {
  severity: 'ERROR' | 'WARN';
  message: string;
  section?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isNonNullObjectOrArray(value: unknown): value is Record<string, unknown> | unknown[] {
  return Boolean(value) && typeof value === 'object';
}

function resolveIncludeValue(includeValue: unknown): string | null {
  if (typeof includeValue === 'string' && includeValue.length > 0) {
    return includeValue;
  }
  return null;
}

export function resolveIncludes(
  entryYaml: Record<string, unknown>,
  packDir: string
): IncludeResolveResult {
  const diagnostics: IncludeDiagnostic[] = [];
  const include = entryYaml.include as WorldPackInclude | undefined;

  if (!include || !isRecord(include) || Object.keys(include).length === 0) {
    return { merged: { ...entryYaml }, diagnostics };
  }

  const merged = { ...entryYaml };
  delete merged.include;

  const loadedFiles = new Map<string, Record<string, unknown>>();

  for (const [sectionKey, includeValue] of Object.entries(include)) {
    if (!VALID_SECTION_KEYS.has(sectionKey)) {
      diagnostics.push({
        severity: 'WARN',
        message: `Unknown section key "${sectionKey}" — will be included but may produce schema warnings`,
        section: sectionKey
      });
    }

    const filePath = resolveIncludeValue(includeValue);
    if (!filePath) {
      diagnostics.push({
        severity: 'ERROR',
        message: `Invalid include value: expected non-empty string`,
        section: sectionKey
      });
      continue;
    }

    const absolutePath = path.resolve(packDir, filePath);
    const relativePath = path.relative(packDir, absolutePath);

    if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
      diagnostics.push({
        severity: 'ERROR',
        message: `Path traversal rejected: "${filePath}"`,
        section: sectionKey
      });
      continue;
    }

    if (!safeFs.existsSync(packDir, absolutePath)) {
      diagnostics.push({
        severity: 'ERROR',
        message: `File not found: "${filePath}"`,
        section: sectionKey
      });
      continue;
    }

    let parsed: Record<string, unknown>;
    if (loadedFiles.has(absolutePath)) {
      parsed = loadedFiles.get(absolutePath)!;
    } else {
      try {
        const content = safeFs.readFileSync(packDir, absolutePath, 'utf-8');
        const result: unknown = YAML.parse(content);
        if (!isNonNullObjectOrArray(result)) {
          diagnostics.push({
            severity: 'ERROR',
            message: `File "${filePath}" resolved to null or non-object value`,
            section: sectionKey
          });
          continue;
        }
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        parsed = result as Record<string, unknown>;
        loadedFiles.set(absolutePath, parsed);
      } catch (err) {
        diagnostics.push({
          severity: 'ERROR',
          message: `YAML parse error in "${filePath}": ${err instanceof Error ? err.message : String(err)}`,
          section: sectionKey
        });
        continue;
      }
    }

    if (sectionKey in entryYaml && sectionKey !== 'include') {
      diagnostics.push({
        severity: 'WARN',
        message: `Section "${sectionKey}" defined both inline and via include "${filePath}". Include takes precedence.`,
        section: sectionKey
      });
    }

    if (Object.keys(parsed).length === 1 && sectionKey in parsed) {
      merged[sectionKey] = parsed[sectionKey];
    } else {
      merged[sectionKey] = parsed;
    }
  }

  const errors = diagnostics.filter((d) => d.severity === 'ERROR');
  if (errors.length > 0) {
    const errorList = errors.map((e) => `[${e.section ?? '?'}] ${e.message}`).join('; ');
    logger.error(`Include resolution failed with ${errors.length} error(s): ${errorList}`);
  }
  const warns = diagnostics.filter((d) => d.severity === 'WARN');
  if (warns.length > 0) {
    const warnList = warns.map((w) => `[${w.section ?? '?'}] ${w.message}`).join('; ');
    logger.warn(`Include resolution warnings: ${warnList}`);
  }

  return { merged, diagnostics };
}
