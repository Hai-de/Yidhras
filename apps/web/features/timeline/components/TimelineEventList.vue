<script setup lang="ts">
import AppButton from '../../../components/ui/AppButton.vue'
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
  <div class="yd-workbench-pane flex h-full min-h-[28rem] flex-col rounded-md">
    <WorkspaceSectionHeader
      title="Timeline Events"
      :subtitle="props.isLoading ? 'Refreshing timeline…' : `${props.items.length} event(s) in current view.`"
    />

    <div v-if="props.items.length > 0" class="min-h-0 flex-1 overflow-auto px-4 py-4 no-scrollbar">
      <div class="space-y-2.5">
        <div
          v-for="item in props.items"
          :key="item.id"
          class="yd-workbench-item rounded-md px-4 py-4"
          :class="item.id === props.selectedEventId ? 'yd-workbench-item--active' : ''"
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

          <AppButton
            v-if="item.sourceActionIntentId"
            class="mt-4"
            @click="emit('openWorkflow', item.sourceActionIntentId, item.id)"
          >
            Open workflow link
          </AppButton>
        </div>
      </div>
    </div>

    <div v-else class="px-4 py-4">
      <WorkspaceEmptyState
        title="No timeline events in current range"
        description="Adjust the selected tick range to inspect another narrative slice."
      />
    </div>
  </div>
</template>
