import type { PluginWebManifestSnapshot } from '../../../composables/api/usePluginApi'

const pluginModuleCache = new Map<string, Promise<unknown>>()

const buildCacheKey = (plugin: PluginWebManifestSnapshot) => {
  return `${plugin.pack_id}:${plugin.installation_id}:${plugin.web_bundle_url ?? 'no-bundle'}`
}

export const getPluginRuntimeLoadErrorMessage = (error: unknown): string => {
  return error instanceof Error ? error.message : 'Unknown plugin runtime load error'
}

export const loadPluginRuntimeModule = async (plugin: PluginWebManifestSnapshot): Promise<unknown> => {
  if (!plugin.web_bundle_url) {
    throw new Error(`Plugin ${plugin.plugin_id} does not expose a web bundle URL`)
  }

  const key = buildCacheKey(plugin)
  const cached = pluginModuleCache.get(key)
  if (cached) {
    return cached
  }

  const pending = import(/* @vite-ignore */ plugin.web_bundle_url).then(module => {
    if (module && typeof module === 'object' && 'default' in module) {
      return (module as { default: unknown }).default
    }

    return module
  })

  pluginModuleCache.set(key, pending)

  try {
    return await pending
  } catch (error) {
    pluginModuleCache.delete(key)
    throw error
  }
}

export const resetPluginRuntimeModuleCache = () => {
  pluginModuleCache.clear()
}
