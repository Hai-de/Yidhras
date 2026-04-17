import { storeToRefs } from 'pinia'
import { watch } from 'vue'

import { getPluginRuntimeLoadErrorMessage,loadPluginRuntimeModule } from '../../features/plugins/runtime/loader'
import { usePluginRuntimeStore } from '../../stores/plugins'
import { useRuntimeStore } from '../../stores/runtime'
import { usePluginApi } from '../api/usePluginApi'

const getErrorMessage = (error: unknown): string => {
  return error instanceof Error ? error.message : 'Unknown plugin runtime error'
}

export const usePluginRuntimeBootstrap = () => {
  const runtimeStore = useRuntimeStore()
  const pluginRuntimeStore = usePluginRuntimeStore()
  const pluginApi = usePluginApi()
  const { worldPack } = storeToRefs(runtimeStore)

  const refresh = async () => {
    const packId = worldPack.value?.id ?? null
    if (!packId) {
      pluginRuntimeStore.setErrorMessage(null)
      return
    }

    pluginRuntimeStore.setFetching(true)
    try {
      const snapshot = await pluginApi.getActivePackPluginRuntime(packId)
      pluginRuntimeStore.applyRuntime(snapshot)
      pluginRuntimeStore.setErrorMessage(null)

      for (const plugin of snapshot.plugins) {
        if (!plugin.web_bundle_url) {
          continue
        }

        pluginRuntimeStore.markBundleLoading(plugin)
        try {
          const runtimeModule = await loadPluginRuntimeModule(plugin)
          pluginRuntimeStore.markBundleLoaded(plugin, runtimeModule)
        } catch (error) {
          pluginRuntimeStore.markBundleError(plugin, getPluginRuntimeLoadErrorMessage(error))
        }
      }
    } catch (error) {
      pluginRuntimeStore.setErrorMessage(getErrorMessage(error))
    } finally {
      pluginRuntimeStore.setFetching(false)
    }
  }

  watch(
    worldPack,
    () => {
      void refresh()
    },
    { immediate: true }
  )

  return {
    refresh
  }
}
