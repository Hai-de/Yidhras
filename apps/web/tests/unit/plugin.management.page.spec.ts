import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('#imports', () => ({
  useRuntimeConfig: () => ({
    public: {}
  })
}))

const listPackPluginsMock = vi.fn()
const confirmPackPluginImportMock = vi.fn()
const enablePackPluginMock = vi.fn()
const disablePackPluginMock = vi.fn()

vi.mock('../../composables/api/usePluginApi', () => ({
  usePluginApi: () => ({
    listPackPlugins: listPackPluginsMock,
    confirmPackPluginImport: confirmPackPluginImportMock,
    enablePackPlugin: enablePackPluginMock,
    disablePackPlugin: disablePackPluginMock,
    getActivePackPluginRuntime: vi.fn()
  })
}))

import { usePluginManagementPage } from '../../features/plugins/composables/usePluginManagementPage'
import { ApiClientError } from '../../lib/http/client'
import { useNotificationsStore } from '../../stores/notifications'
import { useRuntimeStore } from '../../stores/runtime'

const buildListSnapshot = () => ({
  pack_id: 'world-pack-alpha',
  enable_warning: {
    enabled: true,
    require_acknowledgement: true,
    reminder_text: 'warning lecture',
    reminder_text_hash: 'hash-1'
  },
  items: [
    {
      installation_id: 'installation-1',
      plugin_id: 'plugin.alpha',
      version: '0.1.0',
      artifact_id: 'artifact-1',
      lifecycle_state: 'pending_confirmation' as const,
      scope_type: 'pack_local' as const,
      scope_ref: 'world-pack-alpha',
      trust_mode: 'trusted' as const,
      requested_capabilities: ['server.api_route.register', 'web.route.register'],
      granted_capabilities: [],
      confirmed_at: undefined,
      enabled_at: undefined,
      disabled_at: undefined,
      last_error: undefined
    }
  ]
})

describe('usePluginManagementPage', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    listPackPluginsMock.mockReset()
    confirmPackPluginImportMock.mockReset()
    enablePackPluginMock.mockReset()
    disablePackPluginMock.mockReset()

    const runtime = useRuntimeStore()
    runtime.applyRuntimeStatusSnapshot({
      status: 'running',
      runtime_ready: true,
      runtime_speed: {
        mode: 'fixed',
        source: 'default',
        configured_step_ticks: null,
        override_step_ticks: null,
        override_since: null,
        effective_step_ticks: '1'
      },
      scheduler: {
        worker_id: 'scheduler:test',
        partition_count: 1,
        owned_partition_ids: ['p0'],
        assignment_source: 'persisted',
        migration_in_progress_count: 0
      },
      health_level: 'ok',
      world_pack: {
        id: 'world-pack-alpha',
        name: 'Pack Alpha',
        version: '0.1.0'
      },
      has_error: false,
      startup_errors: []
    })
  })

  it('loads plugin inventory and exposes confirm action state', async () => {
    listPackPluginsMock.mockResolvedValue(buildListSnapshot())

    const page = usePluginManagementPage()
    await page.refresh()

    expect(page.selectedInstallation.value?.plugin_id).toBe('plugin.alpha')
    expect(page.selectedRequiresConfirmation.value).toBe(true)
    expect(page.selectedGrantedCapabilities.value).toEqual([])
    expect(page.enableWarning.value.reminder_text_hash).toBe('hash-1')
  })

  it('submits confirm import with selected capability grants', async () => {
    listPackPluginsMock
      .mockResolvedValueOnce(buildListSnapshot())
      .mockResolvedValueOnce({
        ...buildListSnapshot(),
        items: [
          {
            ...buildListSnapshot().items[0],
            lifecycle_state: 'confirmed_disabled' as const,
            granted_capabilities: ['server.api_route.register']
          }
        ]
      })

    confirmPackPluginImportMock.mockResolvedValue({
      acknowledged: true,
      pack_id: 'world-pack-alpha',
      installation: {
        ...buildListSnapshot().items[0],
        lifecycle_state: 'confirmed_disabled',
        granted_capabilities: ['server.api_route.register']
      }
    })

    const page = usePluginManagementPage()
    await page.refresh()
    page.setCapabilityGranted('server.api_route.register', true)
    page.setCapabilityGranted('web.route.register', false)

    await page.confirmSelectedInstallation()

    expect(confirmPackPluginImportMock).toHaveBeenCalledWith('world-pack-alpha', 'installation-1', ['server.api_route.register'])
    expect(page.successMessage.value).toContain('Confirmed plugin.alpha')
  })

  it('requires acknowledgement before enable when config demands it', async () => {
    listPackPluginsMock.mockResolvedValue({
      ...buildListSnapshot(),
      items: [
        {
          ...buildListSnapshot().items[0],
          lifecycle_state: 'confirmed_disabled' as const,
          granted_capabilities: ['server.api_route.register']
        }
      ]
    })

    const page = usePluginManagementPage()
    await page.refresh()

    expect(page.selectedCanEnable.value).toBe(true)
    expect(page.canSubmitEnable.value).toBe(false)

    page.setEnableAcknowledged(true)
    expect(page.canSubmitEnable.value).toBe(true)
  })

  it('submits enable with acknowledgement hash from backend snapshot', async () => {
    listPackPluginsMock
      .mockResolvedValueOnce({
        ...buildListSnapshot(),
        items: [
          {
            ...buildListSnapshot().items[0],
            lifecycle_state: 'confirmed_disabled' as const,
            granted_capabilities: ['server.api_route.register']
          }
        ]
      })
      .mockResolvedValueOnce({
        ...buildListSnapshot(),
        items: [
          {
            ...buildListSnapshot().items[0],
            lifecycle_state: 'enabled' as const,
            granted_capabilities: ['server.api_route.register'],
            enabled_at: '123'
          }
        ]
      })

    enablePackPluginMock.mockResolvedValue({
      acknowledged: true,
      pack_id: 'world-pack-alpha',
      installation: {
        ...buildListSnapshot().items[0],
        lifecycle_state: 'enabled',
        granted_capabilities: ['server.api_route.register'],
        enabled_at: '123'
      }
    })

    const page = usePluginManagementPage()
    await page.refresh()
    page.setEnableAcknowledged(true)

    await page.enableSelectedInstallation()

    expect(enablePackPluginMock).toHaveBeenCalledWith('world-pack-alpha', 'installation-1', {
      reminder_text_hash: 'hash-1',
      actor_label: 'gui'
    })
    expect(page.successMessage.value).toContain('Enabled plugin.alpha')
  })

  it('records ack-required backend failures into warnings and notifications', async () => {
    listPackPluginsMock.mockResolvedValue({
      ...buildListSnapshot(),
      items: [
        {
          ...buildListSnapshot().items[0],
          lifecycle_state: 'confirmed_disabled' as const,
          granted_capabilities: ['server.api_route.register']
        }
      ]
    })

    enablePackPluginMock.mockRejectedValue(
      new ApiClientError({
        code: 'PLUGIN_ENABLE_ACK_REQUIRED',
        message: 'Plugin enable acknowledgement is required',
        status: 400
      })
    )

    const page = usePluginManagementPage()
    const notifications = useNotificationsStore()
    await page.refresh()
    page.setEnableAcknowledged(true)

    await page.enableSelectedInstallation()

    expect(page.acknowledgementRequired.value).toBe(true)
    expect(page.operationErrorMessage.value).toBe('Plugin enable acknowledgement is required')
    expect(notifications.latestError?.code).toBe('PLUGIN_ENABLE_ACK_REQUIRED')
  })

  it('submits disable and refreshes the selection', async () => {
    listPackPluginsMock
      .mockResolvedValueOnce({
        ...buildListSnapshot(),
        items: [
          {
            ...buildListSnapshot().items[0],
            lifecycle_state: 'enabled' as const,
            granted_capabilities: ['server.api_route.register'],
            enabled_at: '123'
          }
        ]
      })
      .mockResolvedValueOnce({
        ...buildListSnapshot(),
        items: [
          {
            ...buildListSnapshot().items[0],
            lifecycle_state: 'disabled' as const,
            granted_capabilities: ['server.api_route.register'],
            disabled_at: '456'
          }
        ]
      })

    disablePackPluginMock.mockResolvedValue({
      acknowledged: true,
      pack_id: 'world-pack-alpha',
      installation: {
        ...buildListSnapshot().items[0],
        lifecycle_state: 'disabled',
        granted_capabilities: ['server.api_route.register'],
        disabled_at: '456'
      }
    })

    const page = usePluginManagementPage()
    await page.refresh()

    await page.disableSelectedInstallation()

    expect(disablePackPluginMock).toHaveBeenCalledWith('world-pack-alpha', 'installation-1')
    expect(page.successMessage.value).toContain('Disabled plugin.alpha')
  })
})
