import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'

import { normalizePluginRuntimeModule, usePluginRuntimeStore } from '../../stores/plugins'

describe('usePluginRuntimeStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('applies active pack plugin runtime snapshot and exposes panel filtering', () => {
    const store = usePluginRuntimeStore()

    store.applyRuntime({
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
        },
        {
          installation_id: 'installation-2',
          plugin_id: 'plugin.beta',
          pack_id: 'world-pack-alpha',
          web_bundle_url: null,
          contributions: {
            panels: [{ target: 'operator.timeline', panel_id: 'beta_timeline' }],
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

    expect(store.activePackId).toBe('world-pack-alpha')
    expect(store.panelPlugins('operator.pack_overview')).toHaveLength(1)
    expect(store.panelPlugins('operator.pack_overview')[0]?.plugin_id).toBe('plugin.alpha')
    expect(store.panelPlugins('operator.timeline')).toHaveLength(1)
    expect(store.lastSyncedAt).toEqual(expect.any(Number))
  })

  it('tracks bundle load state and resolved panel/route contributions', () => {
    const store = usePluginRuntimeStore()
    const plugin = {
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
        format: 'browser_esm' as const,
        export_name: 'default' as const,
        panel_export: 'panels' as const,
        route_export: 'routes' as const
      }
    }

    store.applyRuntime({
      pack_id: 'world-pack-alpha',
      plugins: [plugin]
    })

    store.markBundleLoading(plugin)
    expect(store.bundleState(plugin.installation_id)?.status).toBe('loading')

    store.markBundleLoaded(plugin, {
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

    expect(store.bundleState(plugin.installation_id)?.status).toBe('loaded')
    expect(store.resolvedPanels('operator.pack_overview')).toHaveLength(1)
    expect(store.resolvedRoute('/packs/world-pack-alpha/plugins/plugin.alpha/investigation-console')?.render).toEqual({
      name: 'AlphaRoute'
    })
  })

  it('records bundle load failures', () => {
    const store = usePluginRuntimeStore()
    const plugin = {
      installation_id: 'installation-1',
      plugin_id: 'plugin.alpha',
      pack_id: 'world-pack-alpha',
      web_bundle_url: '/api/packs/world-pack-alpha/plugins/plugin.alpha/runtime/web/installation-1/dist/web/index.mjs',
      contributions: {
        panels: [],
        routes: [],
        menu_items: []
      },
      runtime_module: {
        format: 'browser_esm' as const,
        export_name: 'default' as const,
        panel_export: 'panels' as const,
        route_export: 'routes' as const
      }
    }

    store.applyRuntime({
      pack_id: 'world-pack-alpha',
      plugins: [plugin]
    })
    store.markBundleError(plugin, 'dynamic import failed')

    expect(store.bundleState(plugin.installation_id)?.status).toBe('error')
    expect(store.bundleState(plugin.installation_id)?.error_message).toBe('dynamic import failed')
  })
})

describe('normalizePluginRuntimeModule', () => {
  it('normalizes valid runtime module exports', () => {
    const normalized = normalizePluginRuntimeModule({
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

    expect(normalized.panels).toHaveLength(1)
    expect(normalized.routes).toHaveLength(1)
  })

  it('drops invalid runtime module exports', () => {
    const normalized = normalizePluginRuntimeModule({
      panels: [{ target: '', panel_id: 'missing-target', component: null }],
      routes: [{ route_path: '', component: null }]
    })

    expect(normalized.panels).toEqual([])
    expect(normalized.routes).toEqual([])
  })
})
