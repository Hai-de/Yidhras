import { requestApiData } from '../../lib/http/client'

export interface PluginSummarySnapshot {
  installation_id: string
  plugin_id: string
  version: string
  artifact_id: string
  lifecycle_state:
    | 'discovered'
    | 'pending_confirmation'
    | 'confirmed_disabled'
    | 'enabled'
    | 'disabled'
    | 'upgrade_pending_confirmation'
    | 'error'
    | 'archived'
  scope_type: 'pack_local' | 'global'
  scope_ref?: string
  trust_mode: 'trusted'
  requested_capabilities: string[]
  granted_capabilities: string[]
  last_error?: string
  confirmed_at?: string
  enabled_at?: string
  disabled_at?: string
}

export interface PackPluginListSnapshot {
  pack_id: string
  items: PluginSummarySnapshot[]
}

export interface PluginWebPanelContribution {
  target: string
  panel_id: string
}

export interface PluginWebManifestSnapshot {
  installation_id: string
  plugin_id: string
  pack_id: string
  web_bundle_url: string | null
  contributions: {
    panels: PluginWebPanelContribution[]
    routes: string[]
    menu_items: string[]
  }
  runtime_module: {
    format: 'browser_esm'
    export_name: 'default'
    panel_export: 'panels'
    route_export: 'routes'
  }
}

export interface ActivePackPluginRuntimeSnapshot {
  pack_id: string
  plugins: PluginWebManifestSnapshot[]
}

export const usePluginApi = () => {
  return {
    listPackPlugins: (packId: string) => requestApiData<PackPluginListSnapshot>(`/api/packs/${packId}/plugins`),
    getActivePackPluginRuntime: (packId: string) =>
      requestApiData<ActivePackPluginRuntimeSnapshot>(`/api/packs/${packId}/plugins/runtime/web`)
  }
}
