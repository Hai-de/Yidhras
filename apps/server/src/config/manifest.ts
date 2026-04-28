import fs from 'fs'
import path from 'path'

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
      tree[key] = true
      continue
    }

    if (Array.isArray(value)) {
      tree[key] = true
      continue
    }

    if (typeof value === 'object') {
      tree[key] = extractKeyTree(value as Record<string, unknown>)
      continue
    }

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

  if (!fs.existsSync(fragmentsDir) || !fs.statSync(fragmentsDir).isDirectory()) {
    return {}
  }

  const files = fs
    .readdirSync(fragmentsDir)
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
