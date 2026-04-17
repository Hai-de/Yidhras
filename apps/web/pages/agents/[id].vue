<script setup lang="ts">
import { computed } from 'vue'

import AppPanel from '../../components/ui/AppPanel.vue'
import AppTabs from '../../components/ui/AppTabs.vue'
import {
  buildAgentSchedulerBreakdownItems,
  buildAgentSchedulerJobLinks,
  buildAgentSchedulerReasonList,
  buildAgentSchedulerRunLinks,
  buildAgentSchedulerSkippedReasonList,
  buildAgentSchedulerSummaryMetrics
} from '../../features/agents/adapters'
import AgentSchedulerCard from '../../features/agents/components/AgentSchedulerCard.vue'
import AgentSummaryCard from '../../features/agents/components/AgentSummaryCard.vue'
import { useAgentPage } from '../../features/agents/composables/useAgentPage'
import PluginPanelHost from '../../features/plugins/components/PluginPanelHost.vue'
import SourceContextBanner from '../../features/shared/components/SourceContextBanner.vue'
import WorkspacePageHeader from '../../features/shared/components/WorkspacePageHeader.vue'

const pageLayoutStyle = {
  gap: 'var(--yd-layout-section-gap)',
  padding: 'var(--yd-layout-page-padding-y) var(--yd-layout-page-padding-x)'
} as const

const sectionGridStyle = {
  gap: 'var(--yd-layout-card-gap)'
} as const

const agentTabs = ['overview', 'relations', 'posts', 'workflows', 'memory'] as const

const agentPage = useAgentPage()
const agentSnapshot = computed(() => agentPage.snapshot.value)
const agentActiveTab = computed(() => agentPage.activeTab.value)
const profileFields = computed(() => agentPage.profileFields.value)
const relationshipFields = computed(() => agentPage.relationshipFields.value)
const schedulerDecisionItems = computed(() => agentPage.schedulerDecisionItems.value)
const schedulerProjection = computed(() => agentPage.schedulerProjection.value)
const schedulerSummaryMetrics = computed(() => buildAgentSchedulerSummaryMetrics(schedulerProjection.value))
const schedulerBreakdownItems = computed(() => buildAgentSchedulerBreakdownItems(schedulerProjection.value))
const schedulerReasonItems = computed(() => buildAgentSchedulerReasonList(schedulerProjection.value))
const schedulerSkippedReasonItems = computed(() => buildAgentSchedulerSkippedReasonList(schedulerProjection.value))
const schedulerRunLinks = computed(() => buildAgentSchedulerRunLinks(schedulerProjection.value))
const schedulerJobLinks = computed(() => buildAgentSchedulerJobLinks(schedulerProjection.value))
const agentSourceSummary = computed(() => agentPage.sourceSummary.value)
const agentFreshness = computed(() => {
  return agentPage.isFetching.value ? 'Refreshing agent overview' : 'Agent overview loaded'
})
</script>

<template>
  <div class="flex min-h-full flex-col" :style="pageLayoutStyle">
    <WorkspacePageHeader
      eyebrow="Agent Detail"
      :title="agentSnapshot?.profile.name ?? 'Agent detail'"
      description="Inspect profile state, relation counts, recent workflow volume, memory trace density, and scheduler projection history for a selected agent."
      :freshness="agentFreshness"
    />

    <SourceContextBanner
      v-if="agentSourceSummary"
      :message="agentSourceSummary"
      return-label="Return to source"
      @return="agentPage.returnToSource"
    />

    <div
      v-if="agentPage.errorMessage"
      class="rounded-sm border border-yd-state-danger/40 bg-yd-panel px-4 py-3 text-sm text-yd-state-danger"
    >
      {{ agentPage.errorMessage }}
    </div>

    <AppTabs
      :items="[...agentTabs]"
      compact
      :active-item="agentActiveTab"
      @change="agentPage.setActiveTab($event as 'overview' | 'relations' | 'posts' | 'workflows' | 'memory')"
    />

    <div class="grid xl:grid-cols-2" :style="sectionGridStyle">
      <AgentSummaryCard
        title="Profile"
        subtitle="Core profile and state fields from agent overview projection."
        :fields="profileFields"
      />
      <AgentSummaryCard
        title="Relationships"
        subtitle="Aggregated relation counts and binding summary."
        :fields="relationshipFields"
      />
    </div>

    <div class="grid xl:grid-cols-[1.2fr,0.8fr]" :style="sectionGridStyle">
      <AgentSchedulerCard
        :items="schedulerDecisionItems"
        :breakdown-items="schedulerBreakdownItems"
        :reason-items="schedulerReasonItems"
        :skipped-reason-items="schedulerSkippedReasonItems"
        :run-links="schedulerRunLinks"
        :job-links="schedulerJobLinks"
        @open-decision="agentPage.openSchedulerDecision"
        @open-run="agentPage.openSchedulerRun"
        @open-job="agentPage.openSchedulerJob"
      />

      <AppPanel surface="pane" padded>
        <div class="text-[10px] uppercase tracking-[0.14em] text-yd-text-muted yd-font-mono">
          Active Tab Snapshot
        </div>
        <div class="mt-3 text-sm text-yd-text-secondary">
          Current tab: <span class="text-yd-text-primary yd-font-mono">{{ agentActiveTab }}</span>
        </div>
        <div v-if="agentSnapshot" class="mt-4 grid xl:grid-cols-3" :style="sectionGridStyle">
          <div class="yd-detail-grid-item rounded-sm px-4 py-4">
            <div class="text-[10px] uppercase tracking-[0.12em] text-yd-text-muted yd-font-mono">
              Recent Posts
            </div>
            <div class="mt-2 text-2xl font-semibold text-yd-text-primary yd-font-mono">
              {{ agentSnapshot.recent_posts.length }}
            </div>
          </div>
          <div class="yd-detail-grid-item rounded-sm px-4 py-4">
            <div class="text-[10px] uppercase tracking-[0.12em] text-yd-text-muted yd-font-mono">
              Recent Workflows
            </div>
            <div class="mt-2 text-2xl font-semibold text-yd-text-primary yd-font-mono">
              {{ agentSnapshot.recent_workflows.length }}
            </div>
          </div>
          <div class="yd-detail-grid-item rounded-sm px-4 py-4">
            <div class="text-[10px] uppercase tracking-[0.12em] text-yd-text-muted yd-font-mono">
              Memory Trace Count
            </div>
            <div class="mt-2 text-2xl font-semibold text-yd-text-primary yd-font-mono">
              {{ agentSnapshot.memory.summary.recent_trace_count }}
            </div>
          </div>
        </div>
        <div class="mt-4 grid gap-3 md:grid-cols-2">
          <div
            v-for="metric in schedulerSummaryMetrics"
            :key="metric.id"
            class="yd-detail-grid-item rounded-sm px-4 py-4"
          >
            <div class="text-[10px] uppercase tracking-[0.12em] text-yd-text-muted yd-font-mono">
              {{ metric.label }}
            </div>
            <div class="mt-2 break-all text-lg font-semibold text-yd-text-primary yd-font-mono">
              {{ metric.value }}
            </div>
          </div>
        </div>
        <div v-if="!agentSnapshot" class="mt-4 text-sm text-yd-text-secondary">
          {{ agentPage.isFetching ? 'Loading agent detail…' : 'No agent overview loaded.' }}
        </div>
      </AppPanel>
    </div>

    <PluginPanelHost
      target="operator.entity_overview"
      title="Plugin Entity Panels"
      subtitle="Pack-local web plugin contributions registered for the entity overview workspace."
    />
  </div>
</template>
