<script setup lang="ts">
import { computed } from 'vue'

import AgentSummaryCard from '../../features/agents/components/AgentSummaryCard.vue'
import { useAgentPage } from '../../features/agents/composables/useAgentPage'

const agentPage = useAgentPage()
const agentSnapshot = computed(() => agentPage.snapshot.value)
const agentActiveTab = computed(() => agentPage.activeTab.value)
const profileFields = computed(() => agentPage.profileFields.value)
const relationshipFields = computed(() => agentPage.relationshipFields.value)
</script>

<template>
  <div class="flex h-full flex-col gap-4 overflow-auto p-6 no-scrollbar">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <div>
        <div class="text-[11px] uppercase tracking-[0.22em] text-yd-text-muted yd-font-mono">
          Agent Detail
        </div>
        <h1 class="mt-2 text-2xl font-semibold text-yd-text-primary">
          {{ agentSnapshot?.profile.name ?? 'Agent detail' }}
        </h1>
      </div>
      <div class="flex items-center gap-2">
        <button
          v-for="tab in ['overview', 'relations', 'posts', 'workflows', 'memory']"
          :key="tab"
          type="button"
          class="rounded-lg border px-3 py-2 text-xs uppercase tracking-[0.16em] yd-font-mono"
          :class="agentActiveTab === tab ? 'border-yd-state-accent bg-yd-elevated text-yd-text-primary' : 'border-yd-border-muted text-yd-text-secondary'"
          @click="agentPage.setActiveTab(tab as 'overview' | 'relations' | 'posts' | 'workflows' | 'memory')"
        >
          {{ tab }}
        </button>
      </div>
    </div>

    <div
      v-if="agentPage.errorMessage"
      class="rounded-lg border border-yd-state-danger/40 bg-yd-app px-4 py-3 text-sm text-yd-state-danger"
    >
      {{ agentPage.errorMessage }}
    </div>

    <div class="grid gap-4 xl:grid-cols-2">
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

    <div class="yd-panel-surface rounded-xl px-5 py-5">
      <div class="text-[10px] uppercase tracking-[0.22em] text-yd-text-muted yd-font-mono">
        Active Tab Snapshot
      </div>
      <div class="mt-3 text-sm text-yd-text-secondary">
        Current tab: <span class="text-yd-text-primary yd-font-mono">{{ agentActiveTab }}</span>
      </div>
      <div v-if="agentSnapshot" class="mt-4 grid gap-4 xl:grid-cols-3">
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
      <div v-else class="mt-4 text-sm text-yd-text-secondary">
        {{ agentPage.isFetching ? 'Loading agent detail…' : 'No agent overview loaded.' }}
      </div>
    </div>
  </div>
</template>
