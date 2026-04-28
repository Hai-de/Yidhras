/**
 * 配置安全分级。
 *
 * safe:      可热重载，即时生效（logging.level, features.*）
 * caution:   需确认，运行时生效但记录告警（scheduler agent limit）
 * dangerous: 需重启（sqlite.*, world_engine.binary_path）
 * critical:  需操作员显式确认 + 重启（jwt_secret, default_password）
 */
export const enum ConfigTier {
  SAFE = 'safe',
  CAUTION = 'caution',
  DANGEROUS = 'dangerous',
  CRITICAL = 'critical'
}

/**
 * Maps config domain keys to their security tier.
 * Keys not explicitly listed default to ConfigTier.DANGEROUS.
 */
export const CONFIG_DOMAIN_TIERS: Record<string, ConfigTier> = {
  // Safe — hot-reloadable
  'app.port': ConfigTier.SAFE,
  'logging': ConfigTier.SAFE,
  'features': ConfigTier.SAFE,

  // Caution — runtime-effective but logged
  'world.preferred_pack': ConfigTier.CAUTION,
  'world.preferred_opening': ConfigTier.CAUTION,
  'scheduler.runtime': ConfigTier.CAUTION,
  'scheduler.agent.limit': ConfigTier.CAUTION,
  'scheduler.agent.cooldown_ticks': ConfigTier.CAUTION,
  'scheduler.entity_concurrency': ConfigTier.CAUTION,
  'scheduler.tick_budget': ConfigTier.CAUTION,
  'scheduler.automatic_rebalance': ConfigTier.CAUTION,
  'scheduler.observability': ConfigTier.CAUTION,
  'scheduler.enabled': ConfigTier.CAUTION,
  'prompt_workflow': ConfigTier.CAUTION,
  'clock.max_step_ticks': ConfigTier.CAUTION,

  // Dangerous — requires restart
  'sqlite': ConfigTier.DANGEROUS,
  'paths': ConfigTier.DANGEROUS,
  'world_engine': ConfigTier.DANGEROUS,
  'scheduler.runners': ConfigTier.DANGEROUS,
  'scheduler.agent.decision_kernel': ConfigTier.DANGEROUS,
  'scheduler.memory': ConfigTier.DANGEROUS,
  'scheduler.lease_ticks': ConfigTier.DANGEROUS,
  'plugins.sandbox': ConfigTier.DANGEROUS,
  'runtime': ConfigTier.DANGEROUS,
  'world.bootstrap': ConfigTier.DANGEROUS,
  'startup': ConfigTier.DANGEROUS,

  // Critical — requires operator confirmation + restart
  'operator': ConfigTier.CRITICAL
}

const DEFAULT_TIER = ConfigTier.DANGEROUS

/**
 * Resolve the security tier for a given config path prefix.
 * Returns the most specific match.
 */
export const resolveConfigTier = (pathPrefix: string): ConfigTier => {
  // Exact match
  if (CONFIG_DOMAIN_TIERS[pathPrefix] !== undefined) {
    return CONFIG_DOMAIN_TIERS[pathPrefix]
  }

  // Prefix match: find the longest matching parent key
  const parts = pathPrefix.split('.')
  let bestMatch = DEFAULT_TIER

  for (let i = parts.length; i >= 1; i--) {
    const prefix = parts.slice(0, i).join('.')
    if (CONFIG_DOMAIN_TIERS[prefix] !== undefined) {
      bestMatch = CONFIG_DOMAIN_TIERS[prefix]
      break
    }
  }

  return bestMatch
}

export const tierAllowsHotReload = (tier: ConfigTier): boolean => {
  return tier === ConfigTier.SAFE
}

export const tierRequiresRestart = (tier: ConfigTier): boolean => {
  return tier === ConfigTier.DANGEROUS || tier === ConfigTier.CRITICAL
}
