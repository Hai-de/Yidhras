<template>
  <div class="flex h-full flex-col gap-4 overflow-hidden p-6">
    <TimelineRangeBar
      :from-tick="range.fromTick"
      :to-tick="range.toTick"
      @apply="setRange"
      @reset="handleResetRange"
    />

    <div v-if="errorMessage" class="rounded-lg border border-yd-state-danger/40 bg-yd-app px-4 py-3 text-sm text-yd-state-danger">
      {{ errorMessage }}
    </div>

    <TimelineEventList
      :items="items"
      :selected-event-id="selectedEventId"
      :is-loading="isFetching"
      @select-event="selectEvent"
      @open-workflow="openWorkflow"
    />
  </div>
</template>

<script setup lang="ts">
import TimelineEventList from '../features/timeline/components/TimelineEventList.vue'
import TimelineRangeBar from '../features/timeline/components/TimelineRangeBar.vue'
import { useTimelinePage } from '../features/timeline/composables/useTimelinePage'

const timelinePage = useTimelinePage()

const items = timelinePage.items
const range = timelinePage.range
const selectedEventId = timelinePage.selectedEventId
const isFetching = timelinePage.isFetching
const errorMessage = timelinePage.errorMessage
const setRange = timelinePage.setRange
const selectEvent = timelinePage.selectEvent
const openWorkflow = timelinePage.openWorkflow

const handleResetRange = () => {
  timelinePage.setRange({
    fromTick: null,
    toTick: null
  })
}
</script>
