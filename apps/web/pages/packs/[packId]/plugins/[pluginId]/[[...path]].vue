<template>
  <div class="flex min-h-full flex-col" :style="pageLayoutStyle">
    <WorkspacePageHeader
      eyebrow="Plugin Route"
      :title="pageTitle"
      :description="pageDescription"
      :freshness="runtimeStateLabel"
    />

    <WorkspaceStatusBanner
      v-if="errorMessage"
      tone="warning"
      title="Plugin route unavailable"
      :message="errorMessage"
    />

    <AppPanel>
      <WorkspaceSectionHeader
        title="Pack-local route host"
        subtitle="Dynamic plugin route contribution rendered under the canonical pack-local namespace."
      />

      <div class="px-5 py-5">
        <PluginRenderBoundary
          v-if="resolvedRoute"
          :title="pluginId"
          subtitle="Dynamic plugin route contribution"
        >
          <component :is="resolvedRoute.render" />
        </PluginRenderBoundary>

        <WorkspaceEmptyState
          v-else
          title="Plugin route not found"
          :description="errorMessage ?? 'No plugin route contribution matched the current path.'"
        />
      </div>
    </AppPanel>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vue-router'

import AppPanel from '../../../../../components/ui/AppPanel.vue'
import PluginRenderBoundary from '../../../../../features/plugins/components/PluginRenderBoundary.vue'
import WorkspaceEmptyState from '../../../../../features/shared/components/WorkspaceEmptyState.vue'
import WorkspacePageHeader from '../../../../../features/shared/components/WorkspacePageHeader.vue'
import WorkspaceSectionHeader from '../../../../../features/shared/components/WorkspaceSectionHeader.vue'
import WorkspaceStatusBanner from '../../../../../features/shared/components/WorkspaceStatusBanner.vue'
import { usePluginRuntimeStore } from '../../../../../stores/plugins'

const pageLayoutStyle = {
  gap: 'var(--yd-layout-section-gap)',
  padding: 'var(--yd-layout-page-padding-y) var(--yd-layout-page-padding-x)'
} as const

const route = useRoute()
const pluginRuntime = usePluginRuntimeStore()

const packId = computed(() => (typeof route.params.packId === 'string' ? route.params.packId : null))
const pluginId = computed(() => (typeof route.params.pluginId === 'string' ? route.params.pluginId : 'unknown-plugin'))
const routeSegments = computed(() => {
  const raw = route.params.path
  if (Array.isArray(raw)) {
    return raw.filter((segment): segment is string => typeof segment === 'string' && segment.length > 0)
  }
  if (typeof raw === 'string' && raw.length > 0) {
    return [raw]
  }
  return []
})

const canonicalPluginRoutePath = computed(() => {
  return `/packs/${packId.value ?? 'unknown-pack'}/plugins/${pluginId.value}${routeSegments.value.length > 0 ? `/${routeSegments.value.join('/')}` : ''}`
})

const resolvedRoute = computed(() => {
  return pluginRuntime.resolvedRoute(canonicalPluginRoutePath.value)
})

const pageTitle = computed(() => `${pluginId.value} route`)
const pageDescription = computed(() => `Pack-local plugin route for ${packId.value ?? 'unknown-pack'} at ${canonicalPluginRoutePath.value}`)
const runtimeStateLabel = computed(() => (resolvedRoute.value ? 'Plugin route loaded' : 'Waiting for plugin route runtime'))
const errorMessage = computed(() => {
  if (pluginRuntime.errorMessage) {
    return pluginRuntime.errorMessage
  }

  if (packId.value && pluginRuntime.activePackId && pluginRuntime.activePackId !== packId.value) {
    return `Active plugin runtime is bound to ${pluginRuntime.activePackId}, but route pack is ${packId.value}.`
  }

  const routePlugin = pluginRuntime.runtime?.plugins.find((plugin: { plugin_id: string }) => plugin.plugin_id === pluginId.value) ?? null
  if (!routePlugin) {
    return `Plugin ${pluginId.value} is not present in the active runtime snapshot.`
  }

  const bundleState = pluginRuntime.bundleState(routePlugin.installation_id)
  if (bundleState?.status === 'error') {
    return bundleState.error_message ?? 'Plugin bundle failed to load.'
  }

  if (bundleState?.status === 'loading') {
    return 'Plugin bundle is still loading.'
  }

  if (!resolvedRoute.value) {
    return `No route contribution matched ${canonicalPluginRoutePath.value}.`
  }

  return null
})
</script>
