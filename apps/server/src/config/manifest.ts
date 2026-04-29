import path from 'path'

import { safeFs } from '../utils/safe_fs.js'
import { deepMerge } from './merge.js'

interface ConfigKeyTree {
  [key: string]: ConfigKeyTree | true
}

/**
 * Recursively extracts the key structure from a config object.
 * Leaf values become `true`.
 */
export const extractKeyTree = (obj: Record<string, unknown>): ConfigKeyTree => {
  const tree: ConfigKeyTree = {}

  for (const [key, value] of Object.entries(obj)) {
    if (value === null || value === undefined) {
// eslint-disable-next-line security/detect-object-injection -- 从内部枚举构造的键
      tree[key] = true
      continue
    }

    if (Array.isArray(value)) {
// eslint-disable-next-line security/detect-object-injection -- 从内部枚举构造的键
      tree[key] = true
      continue
    }

    if (typeof value === 'object') {
// eslint-disable-next-line security/detect-object-injection -- 从内部枚举构造的键
      tree[key] = extractKeyTree(value as Record<string, unknown>)
      continue
    }

// eslint-disable-next-line security/detect-object-injection -- 从内部枚举构造的键
    tree[key] = true
  }

  return tree
}

/**
 * Load all template YAML files from conf.d/ and merge into a single canonical config.
 * Returns the merged template defaults (without BUILTIN_DEFAULTS).
 */
export const loadTemplateDefaults = (
  templatesDir: string,
  readYaml: (filePath: string) => Record<string, unknown>
): Record<string, unknown> => {
  const fragmentsDir = path.join(templatesDir, 'conf.d')

  if (!safeFs.existsSync(templatesDir, fragmentsDir) || !safeFs.statSync(templatesDir, fragmentsDir).isDirectory()) {
    return {}
  }

  const files = safeFs
    .readdirSync(templatesDir, fragmentsDir)
    .filter(name => name.endsWith('.yaml') || name.endsWith('.yml'))
    .sort()
    .map(name => path.join(fragmentsDir, name))

  let merged: Record<string, unknown> = {}
  for (const filePath of files) {
    const data = readYaml(filePath)
    if (Object.keys(data).length > 0) {
      merged = deepMerge(merged, data)
    }
  }

  return merged
}
