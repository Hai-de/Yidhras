<script setup lang="ts">
interface DockTab {
  id: string
  label: string
  shortLabel: string
}

const props = defineProps<{
  activeTabId: string
  tabs: DockTab[]
}>()

const emit = defineEmits<{
  select: [tabId: string]
}>()
</script>

<template>
  <div class="border-t border-yd-border-muted bg-yd-panel px-4 py-3">
    <div class="flex items-center gap-2">
      <button
        v-for="tab in props.tabs"
        :key="tab.id"
        type="button"
        class="rounded-md border px-3 py-2 text-[11px] uppercase tracking-[0.18em] transition-colors yd-font-mono"
        :class="[
          tab.id === props.activeTabId
            ? 'border-yd-state-accent bg-yd-elevated text-yd-text-primary'
            : 'border-yd-border-muted text-yd-text-muted hover:border-yd-border-strong hover:text-yd-text-primary'
        ]"
        @click="emit('select', tab.id)"
      >
        {{ tab.shortLabel }}
      </button>
    </div>

    <div class="mt-3 yd-panel-surface rounded-lg px-4 py-3 text-sm text-yd-text-secondary">
      <slot>
        Dock content placeholder
      </slot>
    </div>
  </div>
</template>
