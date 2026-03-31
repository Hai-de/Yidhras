<template>
  <div class="flex h-full flex-col gap-6 overflow-auto p-6 no-scrollbar">
    <div class="grid gap-4 xl:grid-cols-4">
      <OverviewMetricCard
        v-for="item in metricItems"
        :key="item.id"
        :label="item.label"
        :value="item.value"
        :subtitle="item.subtitle"
      />
    </div>

    <div class="grid gap-4 xl:grid-cols-2">
      <div class="yd-panel-surface rounded-xl px-5 py-5">
        <div class="flex items-start justify-between gap-4">
          <div>
            <div class="text-[10px] uppercase tracking-[0.22em] text-yd-text-muted yd-font-mono">
              Runtime Snapshot
            </div>
            <div class="mt-2 text-sm text-yd-text-secondary">
              Aggregated overview read model for the operator console.
            </div>
          </div>
          <button
            type="button"
            class="rounded-lg border border-yd-border-strong bg-yd-elevated px-4 py-2 text-xs uppercase tracking-[0.18em] text-yd-text-primary yd-font-mono"
            @click="refresh"
          >
            Refresh
          </button>
        </div>

        <div v-if="overviewSummary" class="mt-5 grid gap-4 lg:grid-cols-2">
          <div class="rounded-lg border border-yd-border-muted bg-yd-app px-4 py-4">
            <div class="text-[10px] uppercase tracking-[0.18em] text-yd-text-muted yd-font-mono">
              Runtime
            </div>
            <div class="mt-2 text-sm text-yd-text-primary">
              {{ overviewSummary.runtime.status }} · {{ overviewSummary.runtime.health_level }}
            </div>
            <div class="mt-2 text-xs text-yd-text-secondary">
              {{ overviewSummary.runtime.world_pack?.name ?? 'No world pack loaded' }}
            </div>
          </div>
          <div class="rounded-lg border border-yd-border-muted bg-yd-app px-4 py-4">
            <div class="text-[10px] uppercase tracking-[0.18em] text-yd-text-muted yd-font-mono">
              World Time
            </div>
            <div class="mt-2 text-sm text-yd-text-primary yd-font-mono">
              {{ overviewSummary.world_time.tick }}
            </div>
            <div class="mt-2 text-xs text-yd-text-secondary">
              {{ primaryCalendarDisplay }}
            </div>
          </div>
        </div>

        <div v-if="errorMessage" class="mt-4 rounded-lg border border-yd-state-danger/40 bg-yd-app px-4 py-3 text-sm text-yd-state-danger">
          {{ errorMessage }}
        </div>
        <div v-else-if="isFetching && !overviewSummary" class="mt-4 text-sm text-yd-text-secondary">
          Loading overview summary…
        </div>
      </div>

      <OverviewListCard
        title="Notifications"
        subtitle="Current system queue snapshot and recent operator-facing warnings."
        :items="notificationItems"
        empty-message="No system notifications in queue."
      />
    </div>

    <div class="grid gap-4 xl:grid-cols-2">
      <OverviewListCard
        title="Recent Events"
        subtitle="Timeline-facing events from the overview aggregation endpoint."
        :items="recentEventItems"
        empty-message="No recent events available."
      />
      <OverviewListCard
        title="Latest Posts"
        subtitle="Public social activity projected from the overview summary."
        :items="latestPostItems"
        empty-message="No recent posts available."
      />
    </div>

    <div class="grid gap-4 xl:grid-cols-3">
      <OverviewListCard
        title="Latest Propagation"
        subtitle="Workflow entries associated with message propagation."
        :items="latestPropagationItems"
        empty-message="No propagation workflows found."
      />
      <OverviewListCard
        title="Failed Jobs"
        subtitle="Most recent workflow failures surfaced in overview."
        :items="failedJobItems"
        empty-message="No failed jobs found in latest audit window."
      />
      <OverviewListCard
        title="Dropped Intents"
        subtitle="Dropped workflow outcomes surfaced by the overview read model."
        :items="droppedIntentItems"
        empty-message="No dropped intents found in latest audit window."
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'

import { buildOverviewMetricItems, toOverviewAuditListItems, toOverviewNotificationListItems } from '../features/overview/adapters'
import OverviewListCard from '../features/overview/components/OverviewListCard.vue'
import OverviewMetricCard from '../features/overview/components/OverviewMetricCard.vue'
import { useOverviewPage } from '../features/overview/composables/useOverviewPage'

const overviewPage = useOverviewPage()

const overviewSummary = overviewPage.summary
const isFetching = overviewPage.isFetching
const errorMessage = overviewPage.errorMessage
const refresh = overviewPage.refresh

const metricItems = computed(() => {
  return overviewSummary.value ? buildOverviewMetricItems(overviewSummary.value) : []
})

const primaryCalendarDisplay = computed(() => {
  if (!overviewSummary.value) {
    return 'Syncing…'
  }

  return overviewSummary.value.world_time.calendars[0]?.display ?? 'No formatted calendar available'
})

const recentEventItems = computed(() => {
  return overviewSummary.value ? toOverviewAuditListItems(overviewSummary.value.recent_events) : []
})

const latestPostItems = computed(() => {
  return overviewSummary.value ? toOverviewAuditListItems(overviewSummary.value.latest_posts) : []
})

const latestPropagationItems = computed(() => {
  return overviewSummary.value ? toOverviewAuditListItems(overviewSummary.value.latest_propagation) : []
})

const failedJobItems = computed(() => {
  return overviewSummary.value ? toOverviewAuditListItems(overviewSummary.value.failed_jobs) : []
})

const droppedIntentItems = computed(() => {
  return overviewSummary.value ? toOverviewAuditListItems(overviewSummary.value.dropped_intents) : []
})

const notificationItems = computed(() => {
  return overviewSummary.value ? toOverviewNotificationListItems(overviewSummary.value.notifications) : []
})
</script>
