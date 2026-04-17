<template>
  <div class="flex min-h-full flex-col" :style="pageLayoutStyle">
    <WorkspacePageHeader
      eyebrow="Operator Overview"
      title="Runtime, queue, and propagation summary"
      description="A high-level operator snapshot of runtime health, recent events, active posts, workflow exceptions, and scheduler activity projected from the overview read model."
      :freshness="overviewFreshness"
    >
      <template #actions>
        <AppButton @click="refresh">
          Refresh
        </AppButton>
      </template>
    </WorkspacePageHeader>

    <WorkspaceStatusBanner
      v-if="errorMessage"
      title="Overview sync error"
      :message="errorMessage"
    />

    <div class="grid xl:grid-cols-4" :style="sectionGridStyle">
      <OverviewMetricCard
        v-for="item in metricItems"
        :key="item.id"
        :label="item.label"
        :value="item.value"
        :subtitle="item.subtitle"
      />
    </div>

    <div class="grid xl:grid-cols-2" :style="sectionGridStyle">
      <AppPanel>
        <WorkspaceSectionHeader
          title="Runtime Snapshot"
          subtitle="Aggregated overview state for runtime, health, world pack, and clock formatting."
        />

        <div v-if="overviewSummary" class="grid px-5 py-5 lg:grid-cols-2" :style="sectionGridStyle">
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
      </AppPanel>

      <OverviewListCard
        title="Notifications"
        subtitle="Current system queue snapshot and recent operator-facing warnings."
        :items="notificationItems"
        empty-message="No system notifications in queue."
      />
    </div>

    <div class="grid xl:grid-cols-2" :style="sectionGridStyle">
      <SchedulerSummaryCard
        :latest-run-label="schedulerLatestRunLabel"
        :latest-run-meta="schedulerLatestRunMeta"
        :metrics="schedulerSummaryMetrics"
        :highlight-groups="schedulerHighlightGroups"
        @open-scheduler-workspace="overviewPage.openSchedulerWorkspace"
      />
      <SchedulerTrendsCard :items="schedulerTrendItems" />
    </div>

    <div class="grid xl:grid-cols-2" :style="sectionGridStyle">
      <OverviewListCard
        title="Scheduler Runs"
        subtitle="Recent scheduler scans with created/scanned counts, skip pressure, and worker attribution."
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

    <div class="grid xl:grid-cols-2" :style="sectionGridStyle">
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

    <div class="grid xl:grid-cols-3" :style="sectionGridStyle">
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

    <PluginPanelHost
      target="operator.pack_overview"
      title="Plugin Panels"
      subtitle="Pack-local web plugin contributions registered for the overview workspace."
    />
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'

import AppButton from '../components/ui/AppButton.vue'
import AppPanel from '../components/ui/AppPanel.vue'
import {
  buildOverviewMetricItems,
  buildSchedulerDecisionListItems,
  buildSchedulerHighlightGroups,
  buildSchedulerRunListItems,
  buildSchedulerSummaryMetrics,
  buildSchedulerTrendItems,
  toOverviewAuditListItems,
  toOverviewNotificationListItems
} from '../features/overview/adapters'
import OverviewListCard from '../features/overview/components/OverviewListCard.vue'
import OverviewMetricCard from '../features/overview/components/OverviewMetricCard.vue'
import SchedulerSummaryCard from '../features/overview/components/SchedulerSummaryCard.vue'
import SchedulerTrendsCard from '../features/overview/components/SchedulerTrendsCard.vue'
import PluginPanelHost from '../features/plugins/components/PluginPanelHost.vue'
import { useOverviewPage } from '../features/overview/composables/useOverviewPage'
import MetricPill from '../features/shared/components/MetricPill.vue'
import WorkspaceEmptyState from '../features/shared/components/WorkspaceEmptyState.vue'
import WorkspacePageHeader from '../features/shared/components/WorkspacePageHeader.vue'
import WorkspaceSectionHeader from '../features/shared/components/WorkspaceSectionHeader.vue'
import WorkspaceStatusBanner from '../features/shared/components/WorkspaceStatusBanner.vue'
import { formatFreshnessLabel } from '../features/shared/feedback'

const pageLayoutStyle = {
  gap: 'var(--yd-layout-section-gap)',
  padding: 'var(--yd-layout-page-padding-y) var(--yd-layout-page-padding-x)'
} as const

const sectionGridStyle = {
  gap: 'var(--yd-layout-card-gap)'
} as const

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

const schedulerSummaryMetrics = computed(() =>
  buildSchedulerSummaryMetrics(overviewPage.schedulerSummary.value, overviewPage.schedulerProjection.value)
)
const schedulerHighlightGroups = computed(() =>
  buildSchedulerHighlightGroups(overviewPage.schedulerSummary.value, overviewPage.schedulerProjection.value)
)
const schedulerTrendItems = computed(() => buildSchedulerTrendItems(overviewPage.schedulerTrendItems.value))

const schedulerLatestRunLabel = computed(() => {
  const latestRun = overviewPage.schedulerSummary.value?.latest_run
  if (!latestRun) {
    return 'No scheduler run sampled yet'
  }

  return `tick ${latestRun.tick} · ${latestRun.partition_id} · ${latestRun.worker_id}`
})

const schedulerLatestRunMeta = computed(() => {
  const latestRun = overviewPage.schedulerSummary.value?.latest_run
  if (!latestRun) {
    return 'Summary projection will populate after the runtime records scheduler runs.'
  }

  return `created ${latestRun.summary.created_count} · linked workflows ${latestRun.cross_link_summary?.linked_workflow_count ?? 0} · signals ${latestRun.summary.signals_detected_count}`
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
