<script setup lang="ts">
import { computed, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import { useNotificationsStore } from '../../../stores/notifications'
import { useRuntimeStore } from '../../../stores/runtime'
import {
  type DockTabId,
  type OperatorWorkspaceId,
  useShellStore
} from '../../../stores/shell'

const router = useRouter()
const route = useRoute()
const runtime = useRuntimeStore()
const notifications = useNotificationsStore()
const shell = useShellStore()

const activityItems = [
  { id: 'overview', label: 'World Overview', shortLabel: 'OV' },
  { id: 'social', label: 'Social Feed', shortLabel: 'SO' },
  { id: 'workflow', label: 'Workflow Inspector', shortLabel: 'WF' },
  { id: 'timeline', label: 'Narrative Timeline', shortLabel: 'TL' },
  { id: 'graph', label: 'Graph View', shortLabel: 'GR' },
  { id: 'agents', label: 'Agent Detail', shortLabel: 'AG' }
] as const satisfies ReadonlyArray<{
  id: OperatorWorkspaceId
  label: string
  shortLabel: string
}>

const dockTabs = [
  { id: 'traces', label: 'Decision Traces', shortLabel: 'TR' },
  { id: 'jobs', label: 'Jobs', shortLabel: 'JB' },
  { id: 'notifications', label: 'Notifications', shortLabel: 'NT' }
] as const satisfies ReadonlyArray<{
  id: DockTabId
  label: string
  shortLabel: string
}>

const resolveWorkspaceIdFromPath = (path: string): OperatorWorkspaceId => {
  if (path.startsWith('/social')) return 'social'
  if (path.startsWith('/workflow')) return 'workflow'
  if (path.startsWith('/timeline')) return 'timeline'
  if (path.startsWith('/graph')) return 'graph'
  if (path.startsWith('/agents')) return 'agents'
  return 'overview'
}

watch(
  () => route.path,
  path => {
    shell.setActiveWorkspace(resolveWorkspaceIdFromPath(path))
  },
  { immediate: true }
)

const workspaceTitle = computed(() => {
  return activityItems.find(item => item.id === shell.activeWorkspaceId)?.label ?? 'Operator Workspace'
})

const workspaceSubtitle = computed(() => {
  return `Operator view · ${runtime.worldPack?.name ?? 'world pack pending'}`
})

const handleWorkspaceSelect = async (workspaceId: string) => {
  shell.setActiveWorkspace(workspaceId as OperatorWorkspaceId)

  if (workspaceId === 'agents') {
    await router.push('/agents')
    return
  }

  await router.push(`/${workspaceId}`)
}

const latestNotifications = computed(() => notifications.latestItems)
</script>

<template>
  <div class="yd-grid-surface flex h-screen w-screen overflow-hidden bg-yd-app text-yd-text-primary">
    <ActivityRail
      :items="activityItems"
      :active-item-id="shell.activeWorkspaceId"
      @select="handleWorkspaceSelect"
    />

    <WorkspaceSidebar :title="workspaceTitle" :subtitle="workspaceSubtitle">
      <slot name="navigation">
        <div class="space-y-3">
          <div class="yd-panel-surface rounded-lg px-4 py-4">
            <div class="text-[10px] uppercase tracking-[0.22em] text-yd-text-muted yd-font-mono">
              Active View
            </div>
            <div class="mt-2 text-sm font-semibold text-yd-text-primary">
              {{ workspaceTitle }}
            </div>
            <div class="mt-2 text-xs text-yd-text-secondary">
              Shell scaffold placeholder for operator navigation modules.
            </div>
          </div>

          <div class="yd-panel-surface rounded-lg px-4 py-4">
            <div class="text-[10px] uppercase tracking-[0.22em] text-yd-text-muted yd-font-mono">
              Runtime Sync
            </div>
            <div class="mt-2 text-sm text-yd-text-primary yd-font-mono">
              tick {{ runtime.formattedTicks }}
            </div>
            <div class="mt-2 text-xs text-yd-text-secondary">
              status refresh {{ runtime.lastStatusSyncedAt ? 'active' : 'pending' }} · clock refresh
              {{ runtime.lastClockSyncedAt ? 'active' : 'pending' }}
            </div>
          </div>
        </div>
      </slot>
    </WorkspaceSidebar>

    <div class="flex min-w-0 flex-1 flex-col">
      <TopRuntimeBar />

      <main class="min-h-0 flex-1 overflow-hidden">
        <slot />
      </main>

      <BottomDock
        :active-tab-id="shell.activeDockTabId"
        :tabs="dockTabs"
        @select="shell.setActiveDockTab($event)"
      >
        <div class="grid gap-3 lg:grid-cols-3">
          <div class="rounded-md border border-yd-border-muted bg-yd-app px-3 py-3">
            <div class="text-[10px] uppercase tracking-[0.18em] text-yd-text-muted yd-font-mono">
              Decision Traces
            </div>
            <div class="mt-2 text-xs text-yd-text-secondary">
              Trace dock placeholder for Workflow detail polling.
            </div>
          </div>
          <div class="rounded-md border border-yd-border-muted bg-yd-app px-3 py-3">
            <div class="text-[10px] uppercase tracking-[0.18em] text-yd-text-muted yd-font-mono">
              Jobs
            </div>
            <div class="mt-2 text-xs text-yd-text-secondary">
              Job dock placeholder for on-demand workflow snapshots.
            </div>
          </div>
          <div class="rounded-md border border-yd-border-muted bg-yd-app px-3 py-3">
            <div class="flex items-center justify-between text-[10px] uppercase tracking-[0.18em] text-yd-text-muted yd-font-mono">
              <span>Notifications</span>
              <span class="text-yd-text-primary">{{ notifications.unreadCount }}</span>
            </div>
            <div v-if="latestNotifications.length > 0" class="mt-2 space-y-2">
              <div
                v-for="item in latestNotifications"
                :key="item.id"
                class="rounded-md border border-yd-border-muted bg-yd-panel px-3 py-2"
              >
                <div class="text-[10px] uppercase tracking-[0.18em] text-yd-text-muted yd-font-mono">
                  {{ item.level }}
                </div>
                <div class="mt-1 text-xs text-yd-text-secondary">
                  {{ item.content }}
                </div>
              </div>
            </div>
            <div v-else class="mt-2 text-xs text-yd-text-secondary">
              No system notifications yet.
            </div>
          </div>
        </div>
      </BottomDock>
    </div>
  </div>
</template>
