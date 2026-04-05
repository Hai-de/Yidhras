<template>
  <div class="flex min-h-full flex-col" :style="pageLayoutStyle">
    <WorkspacePageHeader
      eyebrow="Scheduler Workspace"
      title="Scheduler control tower"
      description="Inspect scheduler health, recent run/decision activity, ownership topology, worker runtime state, and rebalance history from a unified operator projection."
      :freshness="schedulerFreshness"
    >
      <template #actions>
        <AppButton variant="secondary" @click="schedulerPage.clearFilters">
          Clear Filters
        </AppButton>
        <AppButton @click="schedulerPage.refresh">
          Refresh Scheduler
        </AppButton>
      </template>
    </WorkspacePageHeader>

    <SourceContextBanner
      v-if="schedulerSourceSummary"
      :message="schedulerSourceSummary"
      return-label="Return to source"
      @return="schedulerPage.returnToSource"
    />

    <WorkspaceStatusBanner
      v-if="schedulerPage.errorMessage.value"
      title="Scheduler workspace error"
      :message="schedulerPage.errorMessage.value"
    />

    <SchedulerHighlightStrip :items="highlightCards" />

    <div class="grid xl:grid-cols-4" :style="sectionGridStyle">
      <SchedulerMetricCard
        v-for="item in metricCards"
        :key="item.id"
        :label="item.label"
        :value="item.value"
        :subtitle="item.subtitle"
      />
    </div>

    <div class="grid xl:grid-cols-2" :style="sectionGridStyle">
      <SchedulerSummaryCard
        :latest-run-label="latestRunLabel"
        :latest-run-meta="latestRunMeta"
        :metrics="schedulerSummaryMetrics"
        :highlight-groups="schedulerHighlightGroups"
        @open-scheduler-workspace="schedulerPage.clearFilters"
      />
      <SchedulerTrendsCard :items="schedulerTrendItems" />
    </div>

    <div class="grid xl:grid-cols-2" :style="sectionGridStyle">
      <SchedulerListPanel
        title="Recent Runs"
        subtitle="Latest scheduler runs filtered by current partition / worker focus."
        :items="runRows"
        empty-message="No scheduler runs available for the current filters."
        @select="schedulerPage.openRun"
      />
      <SchedulerRunDetailCard
        title="Run Detail"
        subtitle="Selected scheduler run with worker, lease, and linkage detail."
        :fields="selectedRunFields"
      />
    </div>

    <div class="grid xl:grid-cols-2" :style="sectionGridStyle">
      <SchedulerListPanel
        title="Recent Decisions"
        subtitle="Candidate outcomes with workflow / agent drill-down."
        :items="decisionRows"
        empty-message="No scheduler decisions available for the current filters."
        @select="schedulerPage.openDecision"
      />
      <SchedulerListPanel
        title="Ownership"
        subtitle="Current partition ownership with migration-aware context."
        :items="ownershipRows"
        empty-message="No ownership records available for the current filters."
        @select="schedulerPage.filterByPartition"
      />
    </div>

    <div class="grid xl:grid-cols-3" :style="sectionGridStyle">
      <SchedulerListPanel
        title="Workers"
        subtitle="Worker runtime health and capacity snapshots."
        :items="workerRows"
        empty-message="No scheduler workers available for the current filters."
        @select="schedulerPage.filterByWorker"
      />
      <SchedulerListPanel
        title="Migrations"
        subtitle="Recent ownership migrations filtered by current worker / partition focus."
        :items="migrationRows"
        empty-message="No ownership migrations available for the current filters."
        @select="handleSelectMigration"
      />
      <SchedulerListPanel
        title="Rebalance"
        subtitle="Recent rebalance recommendations, suppressions, and applies."
        :items="rebalanceRows"
        empty-message="No rebalance recommendations available for the current filters."
        @select="handleSelectRebalance"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'

import AppButton from '../components/ui/AppButton.vue'
import {
  buildSchedulerHighlightGroups,
  buildSchedulerSummaryMetrics,
  buildSchedulerTrendItems
} from '../features/overview/adapters'
import SchedulerSummaryCard from '../features/overview/components/SchedulerSummaryCard.vue'
import SchedulerTrendsCard from '../features/overview/components/SchedulerTrendsCard.vue'
import {
  buildSchedulerDecisionRows,
  buildSchedulerHighlightCards,
  buildSchedulerMigrationRows,
  buildSchedulerOwnershipRows,
  buildSchedulerRebalanceRows,
  buildSchedulerRunDetailFields,
  buildSchedulerRunRows,
  buildSchedulerWorkerRows,
  buildSchedulerWorkspaceMetrics
} from '../features/scheduler/adapters'
import SchedulerHighlightStrip from '../features/scheduler/components/SchedulerHighlightStrip.vue'
import SchedulerListPanel from '../features/scheduler/components/SchedulerListPanel.vue'
import SchedulerMetricCard from '../features/scheduler/components/SchedulerMetricCard.vue'
import SchedulerRunDetailCard from '../features/scheduler/components/SchedulerRunDetailCard.vue'
import { useSchedulerPage } from '../features/scheduler/composables/useSchedulerPage'
import SourceContextBanner from '../features/shared/components/SourceContextBanner.vue'
import WorkspacePageHeader from '../features/shared/components/WorkspacePageHeader.vue'
import WorkspaceStatusBanner from '../features/shared/components/WorkspaceStatusBanner.vue'
import { formatFreshnessLabel } from '../features/shared/feedback'

const pageLayoutStyle = {
  gap: 'var(--yd-layout-section-gap)',
  padding: 'var(--yd-layout-page-padding-y) var(--yd-layout-page-padding-x)'
} as const

const sectionGridStyle = {
  gap: 'var(--yd-layout-card-gap)'
} as const

const schedulerPage = useSchedulerPage()

const schedulerProjection = computed(() => schedulerPage.projection.value)
const schedulerSourceSummary = computed(() => schedulerPage.sourceSummary.value)
const metricCards = computed(() => buildSchedulerWorkspaceMetrics(schedulerProjection.value))
const highlightCards = computed(() => buildSchedulerHighlightCards(schedulerProjection.value))
const schedulerSummaryMetrics = computed(() =>
  buildSchedulerSummaryMetrics(schedulerProjection.value?.summary ?? null, schedulerProjection.value)
)
const schedulerHighlightGroups = computed(() =>
  buildSchedulerHighlightGroups(schedulerProjection.value?.summary ?? null, schedulerProjection.value)
)
const schedulerTrendItems = computed(() =>
  buildSchedulerTrendItems(schedulerProjection.value?.trends.points ?? [])
)
const runRows = computed(() => buildSchedulerRunRows(schedulerPage.filteredRuns.value))
const decisionRows = computed(() => buildSchedulerDecisionRows(schedulerPage.filteredDecisions.value))
const ownershipRows = computed(() => buildSchedulerOwnershipRows(schedulerPage.filteredOwnership.value))
const workerRows = computed(() => buildSchedulerWorkerRows(schedulerPage.filteredWorkers.value))
const migrationRows = computed(() => buildSchedulerMigrationRows(schedulerPage.filteredMigrations.value))
const rebalanceRows = computed(() => buildSchedulerRebalanceRows(schedulerPage.filteredRebalance.value))
const selectedRunFields = computed(() => buildSchedulerRunDetailFields(schedulerPage.selectedRun.value))

const schedulerFreshness = computed(() => {
  return formatFreshnessLabel(schedulerPage.lastSyncedAt.value, {
    isSyncing: schedulerPage.isFetching.value,
    syncingLabel: 'Refreshing scheduler control tower',
    idleLabel: 'Awaiting scheduler projection'
  })
})

const latestRunLabel = computed(() => {
  const latestRun = schedulerProjection.value?.latest_run?.run
  if (!latestRun) {
    return 'No latest scheduler run'
  }

  return `tick ${latestRun.tick} · ${latestRun.partition_id} · ${latestRun.worker_id}`
})

const latestRunMeta = computed(() => {
  const latestRun = schedulerProjection.value?.latest_run?.run
  if (!latestRun) {
    return 'Recent scheduler runs will populate after runtime snapshots are persisted.'
  }

  return `created ${latestRun.summary.created_count} · linked workflows ${latestRun.cross_link_summary?.linked_workflow_count ?? 0} · signals ${latestRun.summary.signals_detected_count}`
})

const handleSelectMigration = (migrationId: string) => {
  const migration = schedulerProjection.value?.ownership.recent_migrations.find(item => item.id === migrationId)
  if (!migration) {
    return
  }

  schedulerPage.filterByPartition(migration.partition_id)
}

const handleSelectRebalance = (recommendationId: string) => {
  const recommendation = schedulerProjection.value?.rebalance.recommendations.find(item => item.id === recommendationId)
  if (!recommendation) {
    return
  }

  if (recommendation.partition_id) {
    schedulerPage.filterByPartition(recommendation.partition_id)
    return
  }

  if (recommendation.to_worker_id) {
    schedulerPage.filterByWorker(recommendation.to_worker_id)
  }
}
</script>
