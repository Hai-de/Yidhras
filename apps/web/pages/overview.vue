<template>
  <div class="flex h-full flex-col gap-4 overflow-auto p-6 no-scrollbar">
    <WorkspacePageHeader
      eyebrow="Operator Overview"
      title="Runtime, queue, and propagation summary"
      description="A high-level operator snapshot of runtime health, recent events, active posts, workflow exceptions, and scheduler activity projected from the overview read model."
      :freshness="overviewFreshness"
    >
      <template #actions>
        <button
          type="button"
          class="rounded-lg border border-yd-border-strong bg-yd-elevated px-4 py-2 text-xs uppercase tracking-[0.18em] text-yd-text-primary yd-font-mono"
          @click="refresh"
        >
          Refresh
        </button>
      </template>
    </WorkspacePageHeader>

    <WorkspaceStatusBanner
      v-if="errorMessage"
      title="Overview sync error"
      :message="errorMessage"
    />

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
      <div class="yd-panel-surface rounded-xl">
        <WorkspaceSectionHeader
          title="Runtime Snapshot"
          subtitle="Aggregated overview state for runtime, health, world pack, and clock formatting."
        />

        <div v-if="overviewSummary" class="grid gap-4 px-5 py-5 lg:grid-cols-2">
          <MetricPill label="Runtime" :value="`${overviewSummary.runtime.status} · ${overviewSummary.runtime.health_level}`" />
          <MetricPill label="World Time" :value="overviewSummary.world_time.tick" />
          <MetricPill
            label="World Pack"
            :value="overviewSummary.runtime.world_pack?.name ?? 'No world pack loaded'"
          />
          <MetricPill label="Primary Calendar" :value="primaryCalendarDisplay" />
        </div>

        <div v-else class="px-5 py-5">
          <WorkspaceEmptyState
            :title="isFetching ? 'Loading overview summary…' : 'No overview summary loaded yet.'"
            description="The operator overview will populate once the summary projection returns runtime and audit aggregates."
          />
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
        title="Scheduler Runs"
        subtitle="Recent scheduler scans with created/scanned counts and worker attribution."
        :items="schedulerRunItems"
        empty-message="No scheduler runs available yet."
        @select="handleSelectSchedulerRun"
      />
      <OverviewListCard
        title="Scheduler Decisions"
        subtitle="Recent scheduler candidate outcomes for quick drill-down into workflow or agent context."
        :items="schedulerDecisionListItems"
        empty-message="No scheduler decisions available yet."
        @select="handleSelectSchedulerDecision"
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

import {
  buildOverviewMetricItems,
  buildSchedulerDecisionListItems,
  buildSchedulerRunListItems,
  toOverviewAuditListItems,
  toOverviewNotificationListItems
} from '../features/overview/adapters'
import OverviewListCard from '../features/overview/components/OverviewListCard.vue'
import OverviewMetricCard from '../features/overview/components/OverviewMetricCard.vue'
import { useOverviewPage } from '../features/overview/composables/useOverviewPage'
import MetricPill from '../features/shared/components/MetricPill.vue'
import WorkspaceEmptyState from '../features/shared/components/WorkspaceEmptyState.vue'
import WorkspacePageHeader from '../features/shared/components/WorkspacePageHeader.vue'
import WorkspaceSectionHeader from '../features/shared/components/WorkspaceSectionHeader.vue'
import WorkspaceStatusBanner from '../features/shared/components/WorkspaceStatusBanner.vue'
import { formatFreshnessLabel } from '../features/shared/feedback'

const overviewPage = useOverviewPage()

const overviewSummary = overviewPage.summary
const isFetching = overviewPage.isFetching
const errorMessage = overviewPage.errorMessage
const refresh = overviewPage.refresh

const metricItems = computed(() => {
  return overviewSummary.value ? buildOverviewMetricItems(overviewSummary.value) : []
})

const overviewFreshness = computed(() => {
  return formatFreshnessLabel(overviewPage.lastSyncedAt.value, {
    isSyncing: isFetching.value,
    syncingLabel: 'Refreshing overview projection',
    idleLabel: 'Awaiting first overview sync'
  })
})

const primaryCalendarDisplay = computed(() => {
  if (!overviewSummary.value) {
    return 'Syncing…'
  }

  return overviewSummary.value.world_time.calendars[0]?.display ?? 'No formatted calendar available'
})

const schedulerRunItems = computed(() => buildSchedulerRunListItems(overviewPage.schedulerRunItems.value))
const schedulerDecisionListItems = computed(() => buildSchedulerDecisionListItems(overviewPage.schedulerDecisionItems.value))

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

const handleSelectSchedulerRun = (runId: string) => {
  overviewPage.openSchedulerRun(runId)
}

const handleSelectSchedulerDecision = (decisionId: string) => {
  const decision = overviewPage.schedulerDecisionItems.value.find(item => item.id === decisionId)
  if (!decision) {
    return
  }

  overviewPage.openSchedulerDecision({
    decisionId,
    createdJobId: decision.created_job_id,
    actorId: decision.actor_id
  })
}
</script>
