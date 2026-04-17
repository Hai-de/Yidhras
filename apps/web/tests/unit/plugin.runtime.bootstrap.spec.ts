import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const getActivePackPluginRuntimeMock = vi.fn()
const loadPluginRuntimeModuleMock = vi.fn()

vi.mock('../../composables/api/usePluginApi', () => ({
  usePluginApi: () => ({
    getActivePackPluginRuntime: getActivePackPluginRuntimeMock
  })
}))

vi.mock('../../features/plugins/runtime/loader', () => ({
  loadPluginRuntimeModule: (...args: unknown[]) => loadPluginRuntimeModuleMock(...args),
  getPluginRuntimeLoadErrorMessage: (error: unknown) => (error instanceof Error ? error.message : 'Unknown plugin runtime load error')
}))

import { usePluginRuntimeBootstrap } from '../../composables/app/usePluginRuntimeBootstrap'
import { usePluginRuntimeStore } from '../../stores/plugins'
import { useRuntimeStore } from '../../stores/runtime'

describe('usePluginRuntimeBootstrap', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    getActivePackPluginRuntimeMock.mockReset()
    loadPluginRuntimeModuleMock.mockReset()
  })

  it('loads plugin bundles after fetching runtime snapshot', async () => {
    const runtimeStore = useRuntimeStore()
    const pluginStore = usePluginRuntimeStore()

    runtimeStore.applyRuntimeStatusSnapshot({
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

    getActivePackPluginRuntimeMock.mockResolvedValue({
      pack_id: 'world-pack-alpha',
      plugins: [
        {
          installation_id: 'installation-1',
          plugin_id: 'plugin.alpha',
          pack_id: 'world-pack-alpha',
          web_bundle_url: '/api/packs/world-pack-alpha/plugins/plugin.alpha/runtime/web/installation-1/dist/web/index.mjs',
          contributions: {
            panels: [{ target: 'operator.pack_overview', panel_id: 'alpha_panel' }],
            routes: ['/packs/world-pack-alpha/plugins/plugin.alpha/investigation-console'],
            menu_items: []
          },
          runtime_module: {
            format: 'browser_esm',
            export_name: 'default',
            panel_export: 'panels',
            route_export: 'routes'
          }
        }
      ]
    })

    loadPluginRuntimeModuleMock.mockResolvedValue({
      panels: [
        {
          target: 'operator.pack_overview',
          panel_id: 'alpha_panel',
          component: { name: 'AlphaPanel' }
        }
      ],
      routes: [
        {
          route_path: '/packs/world-pack-alpha/plugins/plugin.alpha/investigation-console',
          component: { name: 'AlphaRoute' }
        }
      ]
    })

    const bootstrap = usePluginRuntimeBootstrap()
    await bootstrap.refresh()

    expect(getActivePackPluginRuntimeMock).toHaveBeenCalledWith('world-pack-alpha')
    expect(loadPluginRuntimeModuleMock).toHaveBeenCalled()
    expect(pluginStore.bundleState('installation-1')?.status).toBe('loaded')
    expect(pluginStore.resolvedPanels('operator.pack_overview')).toHaveLength(1)
  })

  it('records bundle load errors without failing the whole bootstrap', async () => {
    const runtimeStore = useRuntimeStore()
    const pluginStore = usePluginRuntimeStore()

    runtimeStore.applyRuntimeStatusSnapshot({
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

    getActivePackPluginRuntimeMock.mockResolvedValue({
      pack_id: 'world-pack-alpha',
      plugins: [
        {
          installation_id: 'installation-1',
          plugin_id: 'plugin.alpha',
          pack_id: 'world-pack-alpha',
          web_bundle_url: '/api/packs/world-pack-alpha/plugins/plugin.alpha/runtime/web/installation-1/dist/web/index.mjs',
          contributions: {
            panels: [{ target: 'operator.pack_overview', panel_id: 'alpha_panel' }],
            routes: [],
            menu_items: []
          },
          runtime_module: {
            format: 'browser_esm',
            export_name: 'default',
            panel_export: 'panels',
            route_export: 'routes'
          }
        }
      ]
    })

    loadPluginRuntimeModuleMock.mockRejectedValue(new Error('bundle fetch failed'))

    const bootstrap = usePluginRuntimeBootstrap()
    await bootstrap.refresh()

    expect(pluginStore.bundleState('installation-1')?.status).toBe('error')
    expect(pluginStore.bundleState('installation-1')?.error_message).toBe('bundle fetch failed')
    expect(pluginStore.errorMessage).toBeNull()
  })
})
