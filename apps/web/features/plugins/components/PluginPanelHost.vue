<script setup lang="ts">
import { computed } from 'vue'

import AppPanel from '../../../components/ui/AppPanel.vue'
import WorkspaceSectionHeader from '../../shared/components/WorkspaceSectionHeader.vue'
import { usePluginRuntimeStore } from '../../../stores/plugins'

const props = defineProps<{
  target: string
  title: string
  subtitle: string
}>()

const pluginRuntime = usePluginRuntimeStore()

const pluginPanels = computed(() => {
  return pluginRuntime.panelPlugins(props.target)
})
</script>

<template>
  <AppPanel v-if="pluginPanels.length > 0">
    <WorkspaceSectionHeader :title="title" :subtitle="subtitle" />
    <div class="grid gap-3 px-5 py-5">
      <div
        v-for="plugin in pluginPanels"
        :key="plugin.installation_id"
        class="rounded-sm border border-yd-border-muted bg-yd-panel px-4 py-4"
      >
        <div class="text-[10px] uppercase tracking-[0.12em] text-yd-text-muted yd-font-mono">
          Plugin Panel
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
      </div>
    </div>
  </AppPanel>
</template>
