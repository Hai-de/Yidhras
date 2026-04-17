import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'

import { usePluginRuntimeStore } from '../../stores/plugins'

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
          web_bundle_url: '/plugins/alpha/web/index.mjs',
          contributions: {
            panels: [{ target: 'operator.pack_overview', panel_id: 'alpha_panel' }],
            routes: [],
            menu_items: []
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
})
