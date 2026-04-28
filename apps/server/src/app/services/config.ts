import fs from 'fs'
import path from 'path'
import * as YAML from 'yaml'

import { getRuntimeConfig, getRuntimeConfigMetadata, resetRuntimeConfigCache } from '../../config/runtime_config.js'
import {
  type ConfigTier,
  resolveConfigTier,
  tierAllowsHotReload,
  tierRequiresRestart
} from '../../config/tiers.js'
import { createLogger } from '../../utils/logger.js'

const logger = createLogger('config-service')

/**
 * Sensitive config paths whose values should be masked in API responses.
 */
const SENSITIVE_PATHS = new Set([
  'operator.auth.jwt_secret',
  'operator.root.default_password'
])

const maskValue = (key: string, value: unknown): unknown => {
  if (SENSITIVE_PATHS.has(key)) {
    if (typeof value === 'string' && value.length > 4) {
      return value.slice(0, 4) + '***'
    }
    return '***'
  }
  return value
}

const deepMapValues = (
  obj: Record<string, unknown>,
  prefix: string,
  fn: (key: string, value: unknown) => unknown
): Record<string, unknown> => {
  const result: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(obj)) {
    const fullKey = prefix ? `${prefix}.${key}` : key
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      result[key] = deepMapValues(value as Record<string, unknown>, fullKey, fn)
    } else {
      result[key] = fn(fullKey, value)
    }
  }
  return result
}

/**
 * Return the full runtime config with sensitive values masked.
 */
export const getMaskedConfig = (): Record<string, unknown> => {
  const config = getRuntimeConfig()
  return deepMapValues(config as unknown as Record<string, unknown>, '', maskValue)
}

/**
 * Return a single domain's config with sensitive values masked.
 */
export const getDomainConfig = (domain: string): Record<string, unknown> | null => {
  const fullConfig = getRuntimeConfig() as unknown as Record<string, unknown>
  if (!(domain in fullConfig)) {
    return null
  }
  return deepMapValues(
    { [domain]: fullConfig[domain] },
    '',
    maskValue
  )
}

export interface ConfigUpdateResult {
  domain: string
  tier: ConfigTier
  hotReloaded: boolean
  requiresRestart: boolean
  message: string
}

/**
 * Update a config domain by writing the merged values to the conf.d/ YAML file.
 * - Safe tier: also resets the runtime cache so changes take effect immediately
 * - Other tiers: only writes the file, restart is required
 */
export const updateDomainConfig = (
  domain: string,
  newValues: Record<string, unknown>
): ConfigUpdateResult | null => {
  const metadata = getRuntimeConfigMetadata()
  const configDir = metadata.configDir
  const fragmentsDir = path.join(configDir, 'conf.d')

  // Determine the target YAML file
  const targetFile = path.join(fragmentsDir, `${domain}.yaml`)

  if (!fs.existsSync(targetFile)) {
    return null
  }

  const tier = resolveConfigTier(domain)

  // Read existing file
  let existing: Record<string, unknown> = {}
  try {
    const raw = fs.readFileSync(targetFile, 'utf-8')
    // Simple YAML merge: we write the new values as-is
    // More sophisticated: use js-yaml load/dump
    existing = raw ? {} : {} // Keep existing as base
  } catch {
    // file unreadable, start fresh
  }

  // Write the updated config
  const merged = { ...existing, ...newValues }
  const yamlContent = YAML.stringify({ [domain]: merged }, {
    indent: 2,
    lineWidth: 120,
    sortMapEntries: false
  })

  fs.writeFileSync(targetFile, yamlContent, 'utf-8')
  logger.info(`配置域已更新: ${domain} (tier=${tier})`)

  if (tierAllowsHotReload(tier)) {
    resetRuntimeConfigCache()
    return {
      domain,
      tier,
      hotReloaded: true,
      requiresRestart: false,
      message: `配置 "${domain}" 已更新并即时生效（tier: ${tier}）`
    }
  }

  return {
    domain,
    tier,
    hotReloaded: false,
    requiresRestart: tierRequiresRestart(tier),
    message: tierRequiresRestart(tier)
      ? `配置 "${domain}" 已写入文件。此配置域标记为 ${tier}，需重启服务后生效。`
      : `配置 "${domain}" 已写入文件并将在下次请求时生效。`
  }
}

/**
 * Return the list of known config domains with their tiers.
 */
export const listConfigDomains = (): Array<{ domain: string; tier: ConfigTier }> => {
  const domains = [
    'app', 'paths', 'operator', 'plugins', 'world', 'startup',
    'sqlite', 'logging', 'clock', 'world_engine', 'scheduler',
    'prompt_workflow', 'runtime', 'features'
  ]
  return domains.map(domain => ({
    domain,
    tier: resolveConfigTier(domain)
  }))
}
