import { computed, ref } from 'vue'

import { type PluginSummarySnapshot,usePluginApi } from '../../../composables/api/usePluginApi'
import { useRuntimeStore } from '../../../stores/runtime'
import type { OverviewListItemViewModel } from '../../overview/adapters'

const getErrorMessage = (error: unknown): string => {
  return error instanceof Error ? error.message : 'Unknown plugin management error'
}

const classifyRiskLabel = (capabilities: string[]) => {
  if (capabilities.some(capability => capability.startsWith('server.pack_runtime.write') || capability.startsWith('server.local_file_access') || capability.startsWith('server.external_fetch'))) {
    return 'high'
  }

  if (capabilities.some(capability => capability.startsWith('server.intent_grounder.register') || capability.startsWith('server.prompt_workflow.register') || capability.startsWith('server.api_route.register') || capability.startsWith('web.route.register'))) {
    return 'medium'
  }

  return 'low'
}

export const usePluginManagementPage = () => {
  const runtime = useRuntimeStore()
  const pluginApi = usePluginApi()
  const items = ref<PluginSummarySnapshot[]>([])
  const isFetching = ref(false)
  const errorMessage = ref<string | null>(null)
  const selectedInstallationId = ref<string | null>(null)
  const acknowledgementRequired = ref(false)

  const packId = computed(() => runtime.worldPack?.id ?? null)
  const selectedInstallation = computed(() => items.value.find(item => item.installation_id === selectedInstallationId.value) ?? null)

  const refresh = async () => {
    if (!packId.value) {
      items.value = []
      return
    }

    isFetching.value = true
    try {
      const snapshot = await pluginApi.listPackPlugins(packId.value)
      items.value = snapshot.items
      if (!selectedInstallation.value && snapshot.items.length > 0) {
        selectedInstallationId.value = snapshot.items[0]?.installation_id ?? null
      }
      errorMessage.value = null
    } catch (error) {
      errorMessage.value = getErrorMessage(error)
    } finally {
      isFetching.value = false
    }
  }

  const selectInstallation = (installationId: string) => {
    selectedInstallationId.value = installationId
    acknowledgementRequired.value = false
  }

  const pluginListItems = computed(() => {
    return items.value.map<OverviewListItemViewModel>(item => ({
      id: item.installation_id,
      title: `${item.plugin_id} · ${item.version}`,
      meta: `${item.lifecycle_state} · risk ${classifyRiskLabel(item.requested_capabilities)}`,
      tone:
        item.lifecycle_state === 'enabled'
          ? 'success'
          : item.lifecycle_state === 'error'
            ? 'danger'
            : item.lifecycle_state === 'upgrade_pending_confirmation'
              ? 'warning'
              : 'neutral',
      actionLabel: item.lifecycle_state === 'pending_confirmation'
        ? 'Confirm import'
        : item.lifecycle_state === 'confirmed_disabled' || item.lifecycle_state === 'disabled'
          ? 'Enable plugin'
          : item.lifecycle_state === 'enabled'
            ? 'Disable plugin'
            : undefined
    }))
  })

  const selectedRiskLevel = computed(() => {
    return selectedInstallation.value ? classifyRiskLabel(selectedInstallation.value.requested_capabilities) : null
  })

  return {
    packId,
    items,
    isFetching,
    errorMessage,
    selectedInstallation,
    selectedInstallationId,
    selectedRiskLevel,
    acknowledgementRequired,
    pluginListItems,
    refresh,
    selectInstallation,
    setAcknowledgementRequired(value: boolean) {
      acknowledgementRequired.value = value
    }
  }
}
