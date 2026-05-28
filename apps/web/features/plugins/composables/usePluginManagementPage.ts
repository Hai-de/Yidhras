import { computed, ref } from 'vue'

import {
  type PluginEnableWarningSnapshot,
  type PluginSummarySnapshot,
  usePluginApi
} from '../../../composables/api/usePluginApi'
import { ApiClientError } from '../../../lib/http/client'
import { useNotificationsStore } from '../../../stores/notifications'
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

const toActionLabel = (item: PluginSummarySnapshot) => {
  if (item.lifecycle_state === 'pending_confirmation' || item.lifecycle_state === 'upgrade_pending_confirmation') {
    return 'Confirm import'
  }

  if (item.lifecycle_state === 'confirmed_disabled' || item.lifecycle_state === 'disabled') {
    return 'Enable plugin'
  }

  if (item.lifecycle_state === 'enabled') {
    return 'Disable plugin'
  }

  return undefined
}

const defaultEnableWarning = (): PluginEnableWarningSnapshot => ({
  enabled: true,
  require_acknowledgement: true,
  reminder_text: '',
  reminder_text_hash: ''
})

export const usePluginManagementPage = () => {
  const runtime = useRuntimeStore()
  const notifications = useNotificationsStore()
  const pluginApi = usePluginApi()
  const items = ref<PluginSummarySnapshot[]>([])
  const isFetching = ref(false)
  const errorMessage = ref<string | null>(null)
  const successMessage = ref<string | null>(null)
  const selectedInstallationId = ref<string | null>(null)
  const acknowledgementRequired = ref(false)
  const enableWarning = ref<PluginEnableWarningSnapshot>(defaultEnableWarning())
  const operationErrorMessage = ref<string | null>(null)
  const operationBusy = ref(false)
  const selectedGrantedCapabilities = ref<string[]>([])
  const enableAcknowledged = ref(false)

  const packId = computed(() => runtime.worldPack?.id ?? null)
  const selectedInstallation = computed(() => items.value.find(item => item.installation_id === selectedInstallationId.value) ?? null)
  const selectedRiskLevel = computed(() => {
    return selectedInstallation.value ? classifyRiskLabel(selectedInstallation.value.requested_capabilities) : null
  })
  const selectedActionLabel = computed(() => {
    return selectedInstallation.value ? toActionLabel(selectedInstallation.value) : null
  })
  const selectedRequiresConfirmation = computed(() => {
    const lifecycleState = selectedInstallation.value?.lifecycle_state
    return lifecycleState === 'pending_confirmation' || lifecycleState === 'upgrade_pending_confirmation'
  })
  const selectedCanEnable = computed(() => {
    const lifecycleState = selectedInstallation.value?.lifecycle_state
    return lifecycleState === 'confirmed_disabled' || lifecycleState === 'disabled'
  })
  const selectedCanDisable = computed(() => selectedInstallation.value?.lifecycle_state === 'enabled')
  const acknowledgementReminderText = computed(() => {
    return enableWarning.value.enabled ? enableWarning.value.reminder_text : ''
  })
  const selectedCapabilities = computed(() => selectedInstallation.value?.requested_capabilities ?? [])
  const selectedCapabilitiesSummary = computed(() => {
    if (selectedGrantedCapabilities.value.length === 0) {
      return 'No capabilities selected for confirm import. The plugin will stay confirmed but inert until capabilities are granted later.'
    }

    return `${selectedGrantedCapabilities.value.length} capability grant(s) selected for confirmation.`
  })
  const canSubmitConfirm = computed(() => {
    return Boolean(selectedInstallation.value && selectedRequiresConfirmation.value && !operationBusy.value)
  })
  const canSubmitEnable = computed(() => {
    if (!selectedInstallation.value || !selectedCanEnable.value || operationBusy.value) {
      return false
    }

    if (!enableWarning.value.enabled) {
      return true
    }

    if (!enableWarning.value.require_acknowledgement) {
      return true
    }

    return enableAcknowledged.value
  })
  const canSubmitDisable = computed(() => {
    return Boolean(selectedInstallation.value && selectedCanDisable.value && !operationBusy.value)
  })

  const syncSelectionAfterRefresh = (nextItems: PluginSummarySnapshot[]) => {
    if (nextItems.length === 0) {
      selectedInstallationId.value = null
      return
    }

    const existingSelection = selectedInstallationId.value
    if (!existingSelection || !nextItems.some(item => item.installation_id === existingSelection)) {
      selectedInstallationId.value = nextItems[0]?.installation_id ?? null
    }
  }

  const refresh = async () => {
    if (!packId.value) {
      items.value = []
      selectedInstallationId.value = null
      return
    }

    isFetching.value = true
    try {
      const snapshot = await pluginApi.listPackPlugins(packId.value)
      items.value = snapshot.items
      enableWarning.value = snapshot.enable_warning
      syncSelectionAfterRefresh(snapshot.items)
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
    operationErrorMessage.value = null
    successMessage.value = null
    enableAcknowledged.value = false

    const installation = items.value.find(item => item.installation_id === installationId)
    selectedGrantedCapabilities.value = installation?.granted_capabilities.length
      ? [...installation.granted_capabilities]
      : [...(installation?.requested_capabilities ?? [])]
  }

  const setCapabilityGranted = (capability: string, granted: boolean) => {
    if (granted) {
      if (!selectedGrantedCapabilities.value.includes(capability)) {
        selectedGrantedCapabilities.value = [...selectedGrantedCapabilities.value, capability]
      }
      return
    }

    selectedGrantedCapabilities.value = selectedGrantedCapabilities.value.filter(item => item !== capability)
  }

  const pushOperationNotification = (level: 'info' | 'warning' | 'error', content: string, code?: string) => {
    notifications.pushLocalItem({
      level,
      content,
      code
    })
  }

  const runOperation = async (runner: () => Promise<void>) => {
    operationBusy.value = true
    operationErrorMessage.value = null

    try {
      await runner()
    } catch (error) {
      const message = getErrorMessage(error)
      operationErrorMessage.value = message
      pushOperationNotification('error', message, error instanceof ApiClientError ? error.code : 'PLUGIN_GUI_OPERATION_FAILED')
      if (error instanceof ApiClientError && error.code === 'PLUGIN_ENABLE_ACK_REQUIRED') {
        acknowledgementRequired.value = true
      }
    } finally {
      operationBusy.value = false
    }
  }

  const confirmSelectedInstallation = async () => {
    if (!packId.value || !selectedInstallation.value) {
      return
    }

    const currentPackId = packId.value
    const installationId = selectedInstallation.value.installation_id

    await runOperation(async () => {
      const response = await pluginApi.confirmPackPluginImport(
        currentPackId,
        installationId,
        selectedGrantedCapabilities.value
      )
      const message = `Confirmed ${response.installation.plugin_id} for pack-local use.`
      pushOperationNotification('info', message, 'PLUGIN_IMPORT_CONFIRMED')
      await refresh()
      selectInstallation(response.installation.installation_id)
      successMessage.value = message
    })
  }

  const enableSelectedInstallation = async () => {
    if (!packId.value || !selectedInstallation.value) {
      return
    }

    const currentPackId = packId.value
    const installationId = selectedInstallation.value.installation_id

    await runOperation(async () => {
      const acknowledgement = enableWarning.value.enabled && enableWarning.value.require_acknowledgement
        ? {
            reminder_text_hash: enableWarning.value.reminder_text_hash,
            actor_label: 'gui'
          }
        : {
            reminder_text_hash: enableWarning.value.reminder_text_hash,
            actor_label: 'gui'
          }

      const response = await pluginApi.enablePackPlugin(
        currentPackId,
        installationId,
        acknowledgement
      )
      acknowledgementRequired.value = false
      const message = `Enabled ${response.installation.plugin_id} for the active pack.`
      pushOperationNotification('info', message, 'PLUGIN_ENABLED')
      await refresh()
      selectInstallation(response.installation.installation_id)
      successMessage.value = message
    })
  }

  const disableSelectedInstallation = async () => {
    if (!packId.value || !selectedInstallation.value) {
      return
    }

    const currentPackId = packId.value
    const installationId = selectedInstallation.value.installation_id

    await runOperation(async () => {
      const response = await pluginApi.disablePackPlugin(currentPackId, installationId)
      const message = `Disabled ${response.installation.plugin_id}.`
      pushOperationNotification('warning', message, 'PLUGIN_DISABLED')
      await refresh()
      selectInstallation(response.installation.installation_id)
      successMessage.value = message
    })
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
            : item.lifecycle_state === 'pending_confirmation' || item.lifecycle_state === 'upgrade_pending_confirmation'
              ? 'warning'
              : 'neutral',
      actionLabel: toActionLabel(item)
    }))
  })

  return {
    packId,
    items,
    isFetching,
    errorMessage,
    successMessage,
    operationErrorMessage,
    operationBusy,
    selectedInstallation,
    selectedInstallationId,
    selectedRiskLevel,
    selectedActionLabel,
    selectedRequiresConfirmation,
    selectedCanEnable,
    selectedCanDisable,
    acknowledgementRequired,
    acknowledgementReminderText,
    enableWarning,
    enableAcknowledged,
    selectedCapabilities,
    selectedGrantedCapabilities,
    selectedCapabilitiesSummary,
    canSubmitConfirm,
    canSubmitEnable,
    canSubmitDisable,
    pluginListItems,
    refresh,
    selectInstallation,
    setCapabilityGranted,
    setAcknowledgementRequired(value: boolean) {
      acknowledgementRequired.value = value
    },
    setEnableAcknowledged(value: boolean) {
      enableAcknowledged.value = value
    },
    confirmSelectedInstallation,
    enableSelectedInstallation,
    disableSelectedInstallation
  }
}
