import type { RuntimeWorldMetadata } from '../../composables/api/useSystemApi'
import type { ThemeSourceDescriptor, WorldPackThemeConfig } from './tokens'

export interface ResolvedWorldPackThemeConfig {
  config: WorldPackThemeConfig
  source: ThemeSourceDescriptor
}

const WORLD_PACK_THEME_REGISTRY: Record<string, WorldPackThemeConfig> = {}

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

const isThemeConfigLike = (value: unknown): value is WorldPackThemeConfig => {
  if (!isRecord(value)) {
    return false
  }

  return ['meta', 'core', 'layout', 'components'].some(key => key in value)
}

const buildProviderMetadataSource = (worldPackId: string): ThemeSourceDescriptor => {
  return {
    kind: 'provider-metadata',
    worldPackId,
    path: 'presentation.theme',
    label: 'provider metadata (presentation.theme)'
  }
}

const resolveProviderThemeFromCarrier = (worldPack?: RuntimeWorldMetadata | null): ResolvedWorldPackThemeConfig | undefined => {
  const candidate = worldPack?.presentation?.theme

  if (!candidate || !isThemeConfigLike(candidate)) {
    return undefined
  }

  return {
    config: candidate,
    source: buildProviderMetadataSource(worldPack.id)
  }
}

export const registerWorldPackThemeConfig = (worldPackId: string, config: WorldPackThemeConfig): void => {
  WORLD_PACK_THEME_REGISTRY[worldPackId] = config
}

export const clearRegisteredWorldPackThemeConfig = (worldPackId: string): void => {
  delete WORLD_PACK_THEME_REGISTRY[worldPackId]
}

export const resolveWorldPackThemeConfig = (
  worldPackId?: string | null,
  worldPack?: RuntimeWorldMetadata | null
): ResolvedWorldPackThemeConfig | undefined => {
  const providerTheme = resolveProviderThemeFromCarrier(worldPack)
  if (providerTheme) {
    return providerTheme
  }

  const candidateId = worldPackId ?? worldPack?.id ?? null
  if (!candidateId) {
    return undefined
  }

  const registryTheme = WORLD_PACK_THEME_REGISTRY[candidateId]
  if (!registryTheme) {
    return undefined
  }

  return {
    config: registryTheme,
    source: {
      kind: 'registry',
      worldPackId: candidateId,
      path: 'registry',
      label: 'registered world-pack theme'
    }
  }
}
