<script setup lang="ts">
import WorkspaceEmptyState from '../../shared/components/WorkspaceEmptyState.vue'
import WorkspaceSectionHeader from '../../shared/components/WorkspaceSectionHeader.vue'
import type { SchedulerListRowViewModel } from '../adapters'

const props = defineProps<{
  title: string
  subtitle: string
  items: SchedulerListRowViewModel[]
  emptyMessage: string
}>()

const emit = defineEmits<{
  select: [id: string]
}>()

const toneClass = (tone: SchedulerListRowViewModel['tone']) => {
  switch (tone) {
    case 'success':
      return 'yd-tone-success'
    case 'warning':
      return 'yd-tone-warning'
    case 'danger':
      return 'yd-tone-danger'
    case 'info':
      return 'yd-tone-info'
    default:
      return ''
  }
}
</script>

<template>
  <div class="yd-workbench-pane flex h-full min-h-[18rem] flex-col rounded-md">
    <WorkspaceSectionHeader :title="title" :subtitle="subtitle" />

    <div v-if="props.items.length > 0" class="flex-1 space-y-2 overflow-y-auto px-4 py-4 no-scrollbar">
      <button
        v-for="item in props.items"
        :key="item.id"
        type="button"
        class="yd-list-row w-full rounded-sm px-4 py-3 text-left"
        :class="toneClass(item.tone)"
        @click="emit('select', item.id)"
      >
        <div class="text-sm font-medium text-yd-text-primary">
          {{ item.title }}
        </div>
        <div class="mt-2 text-[10px] uppercase tracking-[0.12em] text-yd-text-muted yd-font-mono">
          {{ item.meta }}
        </div>
        <div v-if="item.detail" class="mt-3 text-xs leading-5 text-yd-text-secondary">
          {{ item.detail }}
        </div>
        <div v-if="item.actionLabel" class="mt-3 text-[10px] uppercase tracking-[0.12em] text-yd-state-accent yd-font-mono">
          {{ item.actionLabel }}
        </div>
      </button>
    </div>

    <div v-else class="px-4 py-4">
      <WorkspaceEmptyState title="No items available" :description="emptyMessage" />
    </div>
  </div>
</template>
