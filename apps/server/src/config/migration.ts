import { createLogger } from '../utils/logger.js'
import { deepMergeAll } from './merge.js'

const logger = createLogger('config-migration')

export interface ConfigDriftEntry {
  /** Dotted path to the missing key, e.g. "scheduler.agent.max_candidates" */
  path: string
  /** The default value from the template */
  defaultValue: unknown
}

interface ConfigDriftReport {
  /** Keys present in template but missing from user config */
  missing: ConfigDriftEntry[]
  /** Keys present in user config but not in template (potential stale keys) */
  extra: string[]
  /** Whether any drift was detected */
  hasDrift: boolean
}

const joinPath = (parent: string, key: string): string =>
  parent ? `${parent}.${key}` : key

/**
 * Recursively diff user config against template config.
 * Finds keys that exist in template but are missing from user config.
 */
const diffObjects = (
  user: Record<string, unknown>,
  template: Record<string, unknown>,
  parentPath: string,
  missing: ConfigDriftEntry[],
  extra: string[]
): void => {
  for (const [key, templateValue] of Object.entries(template)) {
    const fullPath = joinPath(parentPath, key)

    if (!(key in user)) {
      missing.push({ path: fullPath, defaultValue: templateValue })
      continue
    }

// eslint-disable-next-line security/detect-object-injection -- 从内部枚举构造的键
    const userValue = user[key]

    if (
      typeof templateValue === 'object' &&
      templateValue !== null &&
      !Array.isArray(templateValue) &&
      typeof userValue === 'object' &&
      userValue !== null &&
      !Array.isArray(userValue)
    ) {
      diffObjects(
        userValue as Record<string, unknown>,
        templateValue as Record<string, unknown>,
        fullPath,
        missing,
        extra
      )
    }
  }

  // Check for extra keys in user config
  for (const key of Object.keys(user)) {
    const fullPath = joinPath(parentPath, key)
    if (!(key in template)) {
      extra.push(fullPath)
    }
  }
}

/**
 * Compare user config against template defaults and report drift.
 */
export const detectConfigDrift = (
  userConfig: Record<string, unknown>,
  templateDefaults: Record<string, unknown>
): ConfigDriftReport => {
  const missing: ConfigDriftEntry[] = []
  const extra: string[] = []

  diffObjects(userConfig, templateDefaults, '', missing, extra)

  return {
    missing,
    extra,
    hasDrift: missing.length > 0 || extra.length > 0
  }
}

/**
 * Merge missing template keys into user config.
 * Preserves all existing user values; only adds keys that are absent.
 * Returns a new object (does not mutate input).
 */
export const applyConfigMigration = (
  userConfig: Record<string, unknown>,
  templateDefaults: Record<string, unknown>
): Record<string, unknown> => {
  // Layering: template first, then user on top.
  // Any key in user config overrides the template value.
  return deepMergeAll({}, templateDefaults, userConfig)
}

/**
 * Log a drift report to the console at warn level.
 */
export const logConfigDrift = (drift: ConfigDriftReport): void => {
  if (!drift.hasDrift) {
    return
  }

  if (drift.missing.length > 0) {
    logger.warn(
      `配置漂移检测: 发现 ${drift.missing.length} 个缺失配置项，将使用默认值填充: ${drift.missing.map(m => m.path).join(', ')}`
    )
  }

  if (drift.extra.length > 0) {
    logger.warn(
      `配置漂移检测: 发现 ${drift.extra.length} 个未知配置项（可能在模板中已被移除）: ${drift.extra.join(', ')}`
    )
  }
}
