<script setup lang="ts">
import WorkspaceEmptyState from '../../shared/components/WorkspaceEmptyState.vue'
import WorkspaceSectionHeader from '../../shared/components/WorkspaceSectionHeader.vue'
import type { OverviewListItemViewModel } from '../adapters'

const props = defineProps<{
  title: string
  subtitle: string
  items: OverviewListItemViewModel[]
  emptyMessage?: string
}>()

const emit = defineEmits<{
  select: [itemId: string]
}>()

const toneClass = (tone: OverviewListItemViewModel['tone']) => {
  switch (tone) {
    case 'success':
      return 'border-yd-state-success/40'
    case 'warning':
      return 'border-yd-state-warning/40'
    case 'danger':
      return 'border-yd-state-danger/40'
    case 'info':
      return 'border-yd-state-info/40'
    default:
      return 'border-yd-border-muted'
  }
}
</script>

<template>
  <div class="yd-panel-surface flex h-full min-h-[18rem] flex-col rounded-xl">
    <WorkspaceSectionHeader :title="title" :subtitle="subtitle" />

    <div v-if="props.items.length > 0" class="flex-1 space-y-3 overflow-y-auto px-5 py-5 no-scrollbar">
      <button
        v-for="item in props.items"
        :key="item.id"
        type="button"
        class="w-full rounded-lg border bg-yd-app px-4 py-3 text-left transition-colors hover:border-yd-state-accent"
        :class="toneClass(item.tone)"
        @click="emit('select', item.id)"
      >
        <div class="text-sm font-medium text-yd-text-primary">
          {{ item.title }}
        </div>
        <div class="mt-2 text-[11px] uppercase tracking-[0.16em] text-yd-text-muted yd-font-mono">
          {{ item.meta }}
        </div>
        <div v-if="item.actionLabel" class="mt-3 text-[10px] uppercase tracking-[0.18em] text-yd-state-accent yd-font-mono">
          {{ item.actionLabel }}
        </div>
      </button>
    </div>

    <div v-else class="px-5 py-5">
      <WorkspaceEmptyState
        title="No items available"
        :description="props.emptyMessage ?? 'No items available.'"
      />
    </div>
  </div>
</template>
