<script setup lang="ts">
import WorkspaceEmptyState from '../../shared/components/WorkspaceEmptyState.vue'
import WorkspaceSectionHeader from '../../shared/components/WorkspaceSectionHeader.vue'
import type { TimelineEventCardViewModel } from '../adapters'

const props = defineProps<{
  items: TimelineEventCardViewModel[]
  selectedEventId: string | null
  isLoading: boolean
}>()

const emit = defineEmits<{
  selectEvent: [event: TimelineEventCardViewModel]
  openWorkflow: [actionIntentId: string, eventId: string]
}>()
</script>

<template>
  <div class="yd-panel-surface flex h-full min-h-[28rem] flex-col rounded-xl">
    <WorkspaceSectionHeader
      title="Timeline Events"
      :subtitle="props.isLoading ? 'Refreshing timeline…' : `${props.items.length} event(s) in current view.`"
    />

    <div v-if="props.items.length > 0" class="min-h-0 flex-1 overflow-auto px-5 py-4 no-scrollbar">
      <div class="space-y-3">
        <div
          v-for="item in props.items"
          :key="item.id"
          class="rounded-xl border px-4 py-4"
          :class="item.id === props.selectedEventId ? 'border-yd-state-accent bg-yd-app/80' : 'border-yd-border-muted bg-yd-app'"
        >
          <button type="button" class="w-full text-left" @click="emit('selectEvent', item)">
            <div class="text-sm font-medium text-yd-text-primary">
              {{ item.title }}
            </div>
            <div class="mt-2 text-[11px] uppercase tracking-[0.16em] text-yd-text-muted yd-font-mono">
              {{ item.meta }}
            </div>
            <div class="mt-4 text-sm leading-6 text-yd-text-secondary">
              {{ item.description }}
            </div>
          </button>

          <button
            v-if="item.sourceActionIntentId"
            type="button"
            class="mt-4 rounded-lg border border-yd-border-strong bg-yd-elevated px-4 py-2 text-xs uppercase tracking-[0.18em] text-yd-text-primary yd-font-mono"
            @click="emit('openWorkflow', item.sourceActionIntentId, item.id)"
          >
            Open workflow link
          </button>
        </div>
      </div>
    </div>

    <div v-else class="px-5 py-5">
      <WorkspaceEmptyState
        title="No timeline events in current range"
        description="Adjust the selected tick range to inspect another narrative slice."
      />
    </div>
  </div>
</template>
