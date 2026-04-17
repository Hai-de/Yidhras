import { defineStore } from 'pinia'

import type { ActivePackPluginRuntimeSnapshot, PluginWebManifestSnapshot } from '../composables/api/usePluginApi'

export interface LoadedPluginPanelContribution {
  target: string
  panel_id: string
  render: unknown
}

export interface LoadedPluginRouteContribution {
  route_path: string
  render: unknown
}

export interface PluginBundleLoadState {
  installation_id: string
  plugin_id: string
  status: 'idle' | 'loading' | 'loaded' | 'error'
  loaded_at: number | null
  error_message: string | null
  panels: LoadedPluginPanelContribution[]
  routes: LoadedPluginRouteContribution[]
}

export interface PluginRuntimeModuleContract {
  panels?: Array<{
    target: string
    panel_id: string
    component: unknown
  }>
  routes?: Array<{
    route_path: string
    component: unknown
  }>
}

const toLoadKey = (installationId: string) => installationId

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === 'object' && value !== null
}

export const normalizePluginRuntimeModule = (value: unknown): PluginRuntimeModuleContract => {
  if (!isRecord(value)) {
    return {
      panels: [],
      routes: []
    }
  }

  const panels = Array.isArray(value.panels)
    ? value.panels
        .filter(isRecord)
        .map(item => ({
          target: typeof item.target === 'string' ? item.target : '',
          panel_id: typeof item.panel_id === 'string' ? item.panel_id : '',
          component: item.component
        }))
        .filter(item => item.target.length > 0 && item.panel_id.length > 0)
    : []

  const routes = Array.isArray(value.routes)
    ? value.routes
        .filter(isRecord)
        .map(item => ({
          route_path: typeof item.route_path === 'string' ? item.route_path : '',
          component: item.component
        }))
        .filter(item => item.route_path.length > 0)
    : []

  return {
    panels,
    routes
  }
}

export const usePluginRuntimeStore = defineStore('plugin-runtime', {
  state: () => ({
    activePackId: null as string | null,
    runtime: null as ActivePackPluginRuntimeSnapshot | null,
    isFetching: false,
    errorMessage: null as string | null,
    lastSyncedAt: null as number | null,
    bundleStates: {} as Record<string, PluginBundleLoadState>
  }),
  getters: {
    panelPlugins: state => (target: string) =>
      state.runtime?.plugins.filter(plugin => plugin.contributions.panels.some(panel => panel.target === target)) ?? [],
    resolvedPanels: state => (target: string) => {
      return Object.values(state.bundleStates)
        .flatMap(item => item.panels)
        .filter(panel => panel.target === target)
    },
    resolvedRoute: state => (routePath: string) => {
      return Object.values(state.bundleStates)
        .flatMap(item => item.routes)
        .find(route => route.route_path === routePath) ?? null
    },
    bundleState: state => (installationId: string) => state.bundleStates[toLoadKey(installationId)] ?? null
  },
  actions: {
    applyRuntime(snapshot: ActivePackPluginRuntimeSnapshot) {
      this.activePackId = snapshot.pack_id
      this.runtime = snapshot
      this.lastSyncedAt = Date.now()

      const allowedKeys = new Set(snapshot.plugins.map(plugin => toLoadKey(plugin.installation_id)))
      this.bundleStates = Object.fromEntries(
        Object.entries(this.bundleStates).filter(([key]) => allowedKeys.has(key))
      )

      for (const plugin of snapshot.plugins) {
        const key = toLoadKey(plugin.installation_id)
        if (!this.bundleStates[key]) {
          this.bundleStates[key] = {
            installation_id: plugin.installation_id,
            plugin_id: plugin.plugin_id,
            status: 'idle',
            loaded_at: null,
            error_message: null,
            panels: [],
            routes: []
          }
        }
      }
    },
    setFetching(value: boolean) {
      this.isFetching = value
    },
    setErrorMessage(message: string | null) {
      this.errorMessage = message
    },
    markBundleLoading(plugin: PluginWebManifestSnapshot) {
      const key = toLoadKey(plugin.installation_id)
      this.bundleStates[key] = {
        installation_id: plugin.installation_id,
        plugin_id: plugin.plugin_id,
        status: 'loading',
        loaded_at: this.bundleStates[key]?.loaded_at ?? null,
        error_message: null,
        panels: [],
        routes: []
      }
    },
    markBundleLoaded(plugin: PluginWebManifestSnapshot, moduleValue: unknown) {
      const key = toLoadKey(plugin.installation_id)
      const normalized = normalizePluginRuntimeModule(moduleValue)
      this.bundleStates[key] = {
        installation_id: plugin.installation_id,
        plugin_id: plugin.plugin_id,
        status: 'loaded',
        loaded_at: Date.now(),
        error_message: null,
        panels: normalized.panels?.map(item => ({
          target: item.target,
          panel_id: item.panel_id,
          render: item.component
        })) ?? [],
        routes: normalized.routes?.map(item => ({
          route_path: item.route_path,
          render: item.component
        })) ?? []
      }
    },
    markBundleError(plugin: PluginWebManifestSnapshot, message: string) {
      const key = toLoadKey(plugin.installation_id)
      this.bundleStates[key] = {
        installation_id: plugin.installation_id,
        plugin_id: plugin.plugin_id,
        status: 'error',
        loaded_at: this.bundleStates[key]?.loaded_at ?? null,
        error_message: message,
        panels: [],
        routes: []
      }
    }
  }
})
