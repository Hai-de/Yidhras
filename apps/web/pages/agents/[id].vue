<script setup lang="ts">
import { computed } from 'vue'

import AppPanel from '../../components/ui/AppPanel.vue'
import AppTabs from '../../components/ui/AppTabs.vue'
import {
  buildAgentSchedulerSummaryMetrics
} from '../../features/agents/adapters'
import AgentSchedulerCard from '../../features/agents/components/AgentSchedulerCard.vue'
import AgentSummaryCard from '../../features/agents/components/AgentSummaryCard.vue'
import { useAgentPage } from '../../features/agents/composables/useAgentPage'
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
const schedulerSummaryMetrics = computed(() => buildAgentSchedulerSummaryMetrics(agentPage.schedulerDecisions.value))
const agentSourceSummary = computed(() => agentPage.sourceSummary.value)
const agentFreshness = computed(() => {
  return agentPage.isFetching.value ? 'Refreshing agent overview' : 'Agent overview loaded'
})
</script>

<template>
  <div class="flex h-full flex-col overflow-auto no-scrollbar" :style="pageLayoutStyle">
    <WorkspacePageHeader
      eyebrow="Agent Detail"
      :title="agentSnapshot?.profile.name ?? 'Agent detail'"
      description="Inspect profile state, relation counts, recent workflow volume, memory trace density, and scheduler decision history for a selected agent projection."
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
      class="rounded-lg border border-yd-state-danger/40 bg-yd-app px-4 py-3 text-sm text-yd-state-danger"
    >
      {{ agentPage.errorMessage }}
    </div>

    <AppTabs
      :items="[...agentTabs]"
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

    <div class="grid xl:grid-cols-[1fr,1fr]" :style="sectionGridStyle">
      <AgentSchedulerCard
        :items="schedulerDecisionItems"
        @open-decision="agentPage.openSchedulerDecision"
      />

      <AppPanel padded>
        <div class="text-[10px] uppercase tracking-[0.22em] text-yd-text-muted yd-font-mono">
          Active Tab Snapshot
        </div>
        <div class="mt-3 text-sm text-yd-text-secondary">
          Current tab: <span class="text-yd-text-primary yd-font-mono">{{ agentActiveTab }}</span>
        </div>
        <div v-if="agentSnapshot" class="mt-4 grid xl:grid-cols-3" :style="sectionGridStyle">
          <div class="rounded-xl border border-yd-border-muted bg-yd-app px-4 py-4">
            <div class="text-[10px] uppercase tracking-[0.18em] text-yd-text-muted yd-font-mono">
              Recent Posts
            </div>
            <div class="mt-2 text-2xl font-semibold text-yd-text-primary yd-font-mono">
              {{ agentSnapshot.recent_posts.length }}
            </div>
          </div>
          <div class="rounded-xl border border-yd-border-muted bg-yd-app px-4 py-4">
            <div class="text-[10px] uppercase tracking-[0.18em] text-yd-text-muted yd-font-mono">
              Recent Workflows
            </div>
            <div class="mt-2 text-2xl font-semibold text-yd-text-primary yd-font-mono">
              {{ agentSnapshot.recent_workflows.length }}
            </div>
          </div>
          <div class="rounded-xl border border-yd-border-muted bg-yd-app px-4 py-4">
            <div class="text-[10px] uppercase tracking-[0.18em] text-yd-text-muted yd-font-mono">
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
            class="rounded-xl border border-yd-border-muted bg-yd-app px-4 py-4"
          >
            <div class="text-[10px] uppercase tracking-[0.18em] text-yd-text-muted yd-font-mono">
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
  </div>
</template>
