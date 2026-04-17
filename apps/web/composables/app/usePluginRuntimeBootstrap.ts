import { storeToRefs } from 'pinia'
import { watch } from 'vue'

import { useRuntimeStore } from '../../stores/runtime'
import { usePluginRuntimeStore } from '../../stores/plugins'
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
    } catch (error) {
      pluginRuntimeStore.setErrorMessage(getErrorMessage(error))
    } finally {
      pluginRuntimeStore.setFetching(false)
    }
  }

  watch(worldPack, () => {
    void refresh()
  }, { immediate: true })

  return {
    refresh
  }
}
