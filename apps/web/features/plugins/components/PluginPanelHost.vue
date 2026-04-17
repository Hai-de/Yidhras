<script setup lang="ts">
import { computed } from 'vue'

import AppPanel from '../../../components/ui/AppPanel.vue'
import { usePluginRuntimeStore } from '../../../stores/plugins'
import WorkspaceSectionHeader from '../../shared/components/WorkspaceSectionHeader.vue'
import PluginRenderBoundary from './PluginRenderBoundary.vue'

const props = defineProps<{
  target: string
  title: string
  subtitle: string
}>()

const pluginRuntime = usePluginRuntimeStore()

const pluginPanels = computed(() => {
  return pluginRuntime.panelPlugins(props.target)
})

const resolvedPanels = computed(() => {
  return pluginRuntime.resolvedPanels(props.target)
})
</script>

<template>
  <AppPanel v-if="pluginPanels.length > 0 || resolvedPanels.length > 0">
    <WorkspaceSectionHeader :title="title" :subtitle="subtitle" />
    <div class="grid gap-3 px-5 py-5">
      <PluginRenderBoundary
        v-for="panel in resolvedPanels"
        :key="`${panel.target}:${panel.panel_id}`"
        :title="panel.panel_id"
        subtitle="Dynamic plugin panel contribution"
      >
        <component :is="panel.render" />
      </PluginRenderBoundary>

      <div
        v-for="plugin in pluginPanels"
        :key="plugin.installation_id"
        class="rounded-sm border border-yd-border-muted bg-yd-panel px-4 py-4"
      >
        <div class="text-[10px] uppercase tracking-[0.12em] text-yd-text-muted yd-font-mono">
          Plugin Runtime
        </div>
        <div class="mt-2 text-sm font-semibold text-yd-text-primary yd-font-mono">
          {{ plugin.plugin_id }}
        </div>
        <div class="mt-2 text-xs text-yd-text-secondary">
          Panels: {{ plugin.contributions.panels.map(panel => panel.panel_id).join(', ') || 'none' }}
        </div>
        <div class="mt-1 text-xs text-yd-text-secondary">
          Web bundle: {{ plugin.web_bundle_url ?? 'not provided' }}
        </div>
        <div class="mt-1 text-xs text-yd-text-secondary">
          Runtime state:
          {{ pluginRuntime.bundleState(plugin.installation_id)?.status ?? 'idle' }}
          <span v-if="pluginRuntime.bundleState(plugin.installation_id)?.error_message">
            · {{ pluginRuntime.bundleState(plugin.installation_id)?.error_message }}
          </span>
        </div>
      </div>
    </div>
  </AppPanel>
</template>
