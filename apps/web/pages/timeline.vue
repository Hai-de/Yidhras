<template>
  <div class="flex min-h-full flex-col gap-4 p-6">
    <WorkspacePageHeader
      eyebrow="Narrative Timeline"
      title="Event stream and historical slices"
      description="Filter narrative events by tick range, review the most recent world changes, and jump from a timeline event into its linked workflow intent."
      :freshness="timelineFreshness"
    >
      <template #actions>
        <button
          type="button"
          class="rounded-lg border border-yd-border-strong bg-yd-elevated px-4 py-2 text-xs uppercase tracking-[0.18em] text-yd-text-primary yd-font-mono"
          @click="refresh"
        >
          Refresh Timeline
        </button>
      </template>
    </WorkspacePageHeader>

    <SourceContextBanner
      v-if="timelineSourceSummary"
      :message="timelineSourceSummary"
      return-label="Return to source"
      @return="returnToSource"
    />

    <WorkspaceStatusBanner
      v-if="mappingHint"
      tone="info"
      title="Timeline Mapping Context"
      :message="mappingHint"
    />

    <TimelineRangeBar
      :from-tick="range.fromTick"
      :to-tick="range.toTick"
      @apply="setRange"
      @reset="handleResetRange"
    />

    <WorkspaceStatusBanner
      v-if="errorMessage"
      title="Timeline load error"
      :message="errorMessage"
    />

    <div class="grid min-h-0 flex-1 gap-4 xl:grid-cols-[1.05fr,0.95fr]">
      <TimelineEventList
        :items="items"
        :selected-event-id="selectedEventId"
        :is-loading="isFetching"
        @select-event="selectEvent"
        @open-workflow="openWorkflow"
      />
      <TimelineEventDetail
        :event="selectedEvent"
        @open-workflow="openWorkflow"
        @open-social="timelinePage.openSocial"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'

import SourceContextBanner from '../features/shared/components/SourceContextBanner.vue'
import WorkspacePageHeader from '../features/shared/components/WorkspacePageHeader.vue'
import WorkspaceStatusBanner from '../features/shared/components/WorkspaceStatusBanner.vue'
import { formatFreshnessLabel } from '../features/shared/feedback'
import TimelineEventDetail from '../features/timeline/components/TimelineEventDetail.vue'
import TimelineEventList from '../features/timeline/components/TimelineEventList.vue'
import TimelineRangeBar from '../features/timeline/components/TimelineRangeBar.vue'
import { useTimelinePage } from '../features/timeline/composables/useTimelinePage'

const timelinePage = useTimelinePage()

const items = timelinePage.items
const selectedEvent = timelinePage.selectedEvent
const range = timelinePage.range
const selectedEventId = timelinePage.selectedEventId
const isFetching = timelinePage.isFetching
const errorMessage = timelinePage.errorMessage
const setRange = timelinePage.setRange
const selectEvent = timelinePage.selectEvent
const openWorkflow = timelinePage.openWorkflow
const refresh = timelinePage.refresh
const timelineSourceSummary = timelinePage.sourceSummary
const mappingHint = timelinePage.mappingHint
const returnToSource = timelinePage.returnToSource

const timelineFreshness = computed(() => {
  return formatFreshnessLabel(timelinePage.lastSyncedAt.value, {
    isSyncing: isFetching.value,
    syncingLabel: 'Refreshing timeline projection',
    idleLabel: 'Awaiting first timeline sync'
  })
})

const handleResetRange = () => {
  timelinePage.setRange({
    fromTick: null,
    toTick: null
  })
}
</script>
