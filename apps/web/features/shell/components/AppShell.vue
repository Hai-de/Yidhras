<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import { useNotificationsStore } from '../../../stores/notifications'
import { useRuntimeStore } from '../../../stores/runtime'
import type { DockTabId, OperatorWorkspaceId } from '../../../stores/shell'
import { useShellStore } from '../../../stores/shell'
import { useOperatorSourceContext } from '../../shared/source-context'
import { useShellContext } from '../composables/useShellContext'
import ActivityRail from './ActivityRail.vue'
import BottomDock from './BottomDock.vue'
import ShellSettingsMenu from './ShellSettingsMenu.vue'
import StatusBar from './StatusBar.vue'
import TopRuntimeBar from './TopRuntimeBar.vue'
import WorkspaceSidebar from './WorkspaceSidebar.vue'

const router = useRouter()
const route = useRoute()
const runtime = useRuntimeStore()
const notifications = useNotificationsStore()
const shell = useShellStore()
const shellContext = useShellContext()
const sourceContext = useOperatorSourceContext()
const isSettingsOpen = ref(false)

const DEFAULT_DOCK_HEIGHT = 224
const MIN_DOCK_HEIGHT = 160

const resolveDockBodyElement = (value: unknown) => {
  if (value instanceof HTMLElement) {
    dockBodyRef.value = value
    return
  }

  dockBodyRef.value = null
}

const dockBodyRef = ref<HTMLElement | null>(null)
const availableDockHeight = ref(DEFAULT_DOCK_HEIGHT)
let dockResizeObserver: ResizeObserver | null = null

const updateAvailableDockHeight = () => {
  if (!dockBodyRef.value) {
    availableDockHeight.value = DEFAULT_DOCK_HEIGHT
    return
  }

  const nextMaxHeight = Math.max(dockBodyRef.value.clientHeight, MIN_DOCK_HEIGHT)
  availableDockHeight.value = nextMaxHeight

  if (shell.dockHeight > nextMaxHeight) {
    shell.setDockHeight(nextMaxHeight)
  }
}

const clampedDockHeight = computed(() => {
  return Math.min(Math.max(shell.dockHeight, MIN_DOCK_HEIGHT), availableDockHeight.value)
})

const handleWindowResize = () => {
  updateAvailableDockHeight()
}

onMounted(async () => {
  await nextTick()
  updateAvailableDockHeight()

  if (typeof window !== 'undefined') {
    window.addEventListener('resize', handleWindowResize)
  }

  if (typeof ResizeObserver !== 'undefined' && dockBodyRef.value) {
    dockResizeObserver = new ResizeObserver(() => {
      updateAvailableDockHeight()
    })
    const observedElement = dockBodyRef.value
    dockResizeObserver.observe(observedElement)
  }
})

onBeforeUnmount(() => {
  if (typeof window !== 'undefined') {
    window.removeEventListener('resize', handleWindowResize)
  }

  dockResizeObserver?.disconnect()
  dockResizeObserver = null
})

watch(
  () => shell.isDockExpanded,
  async () => {
    await nextTick()
    updateAvailableDockHeight()
  }
)

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

const panelTabs = [
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

const recordRecentTargetForRoute = (path: string, fullPath: string) => {
  if (path.startsWith('/workflow') && route.query.job_id && typeof route.query.job_id === 'string') {
    shell.recordRecentTarget({
      id: `workflow:${route.query.job_id}`,
      label: `Workflow job ${route.query.job_id}`,
      meta: 'workflow selection',
      workspaceId: 'workflow',
      routePath: fullPath
    })
    return
  }

  if (path.startsWith('/social') && route.query.post_id && typeof route.query.post_id === 'string') {
    shell.recordRecentTarget({
      id: `social:${route.query.post_id}`,
      label: `Social post ${route.query.post_id}`,
      meta: 'social selection',
      workspaceId: 'social',
      routePath: fullPath
    })
    return
  }

  if (path.startsWith('/graph') && route.query.root_id && typeof route.query.root_id === 'string') {
    shell.recordRecentTarget({
      id: `graph:${route.query.root_id}`,
      label: `Graph root ${route.query.root_id}`,
      meta: 'graph focus',
      workspaceId: 'graph',
      routePath: fullPath
    })
    return
  }

  if (path.startsWith('/agents/') && typeof route.params.id === 'string') {
    shell.recordRecentTarget({
      id: `agent:${route.params.id}`,
      label: `Agent ${route.params.id}`,
      meta: 'agent detail',
      workspaceId: 'agents',
      routePath: fullPath
    })
  }
}

watch(
  () => route.path,
  path => {
    shell.setActiveWorkspace(resolveWorkspaceIdFromPath(path))
    isSettingsOpen.value = false
  },
  { immediate: true }
)

watch(
  () => route.fullPath,
  fullPath => {
    recordRecentTargetForRoute(route.path, fullPath)
  },
  { immediate: true }
)

const workspaceTitle = computed(() => shellContext.value.workspaceTitle)
const workspaceSubtitle = computed(() => shellContext.value.workspaceSubtitle)

const traceTargets = computed(() => {
  return shellContext.value.recentTargets.filter(target => target.id.startsWith('workflow:')).slice(0, 4)
})

const jobTargets = computed(() => {
  return shellContext.value.recentTargets
    .filter(target => target.id.startsWith('workflow:') || target.id.startsWith('agent:'))
    .slice(0, 4)
})

const isOperatorWorkspaceId = (value: string): value is OperatorWorkspaceId => {
  return activityItems.some(item => item.id === value)
}

const handleWorkspaceSelect = async (workspaceId: string) => {
  if (!isOperatorWorkspaceId(workspaceId)) return
  shell.setActiveWorkspace(workspaceId)

  if (workspaceId === 'agents') {
    await router.push('/agents')
    return
  }

  await router.push(`/${workspaceId}`)
}

const handleReturnToSource = async () => {
  if (sourceContext.source.value.sourcePage === 'social' && sourceContext.source.value.sourcePostId) {
    await router.push({
      path: '/social',
      query: {
        post_id: sourceContext.source.value.sourcePostId
      }
    })
    return
  }

  if (sourceContext.source.value.sourcePage === 'timeline' && sourceContext.source.value.sourceEventId) {
    await router.push({
      path: '/timeline',
      query: {
        event_id: sourceContext.source.value.sourceEventId
      }
    })
    return
  }

  if (sourceContext.source.value.sourcePage === 'graph' && sourceContext.source.value.sourceRootId) {
    await router.push({
      path: '/graph',
      query: {
        root_id: sourceContext.source.value.sourceRootId,
        ...(sourceContext.source.value.sourceNodeId
          ? { selected_node_id: sourceContext.source.value.sourceNodeId }
          : {})
      }
    })
    return
  }

  if (sourceContext.source.value.sourcePage === 'agent' && sourceContext.source.value.sourceAgentId) {
    await router.push(`/agents/${sourceContext.source.value.sourceAgentId}`)
    return
  }

  if (sourceContext.source.value.sourcePage === 'workflow') {
    await router.push('/workflow')
    return
  }

  if (sourceContext.source.value.sourcePage === 'overview') {
    await router.push('/overview')
  }
}

const handleShellAction = async (actionId: string) => {
  if (actionId === 'go_overview') {
    await router.push('/overview')
    return
  }

  if (actionId === 'return_to_source') {
    await handleReturnToSource()
    return
  }

  if (actionId === 'open_notifications') {
    shell.setDockExpanded(true)
    shell.setActiveDockTab('notifications')
  }
}

const handleOpenRecentTarget = async (routePath: string) => {
  await router.push(routePath)
}

const handlePanelTabSelect = (tabId: DockTabId) => {
  shell.setDockExpanded(true)
  shell.setActiveDockTab(tabId)
}

const handleDockResize = (nextHeight: number) => {
  shell.setDockHeight(Math.min(Math.max(nextHeight, MIN_DOCK_HEIGHT), availableDockHeight.value))
}

const handleStatusBarAction = (actionId: string) => {
  if (actionId === 'settings') {
    isSettingsOpen.value = !isSettingsOpen.value
    return
  }

  if (actionId === 'toggle_panel') {
    shell.toggleDockExpanded()
    return
  }

  if (actionId === 'open_notifications') {
    shell.setDockExpanded(true)
    shell.setActiveDockTab('notifications')
    return
  }

  if (actionId === 'open_jobs') {
    shell.setDockExpanded(true)
    shell.setActiveDockTab('jobs')
    return
  }

  if (actionId === 'open_traces') {
    shell.setDockExpanded(true)
    shell.setActiveDockTab('traces')
  }
}

const handleOpenSettings = () => {
  isSettingsOpen.value = !isSettingsOpen.value
}

const runtimeSummary = computed(() => {
  return `${runtime.statusFreshnessLabel} · ${runtime.clockFreshnessLabel}`
})

const notificationsSummary = computed(() => {
  return `${notifications.unreadCount} total · ${notifications.errorCount} error`
})

const settingsRuntimeLabel = computed(() => {
  return `${runtime.runtimeReady ? 'Runtime ready' : 'Runtime booting'} · ${runtime.worldPack?.name ?? 'No world pack loaded'}`
})

const settingsNotificationsLabel = computed(() => {
  return `${notifications.errorCount} error · ${notifications.warningCount} warning · ${notifications.unreadCount} total`
})

const statusBarActions = computed(() => {
  return [
    { id: 'open_traces', label: 'TR', active: shell.isDockExpanded && shell.activeDockTabId === 'traces' },
    { id: 'open_jobs', label: 'JB', active: shell.isDockExpanded && shell.activeDockTabId === 'jobs' },
    { id: 'open_notifications', label: 'NT', active: shell.isDockExpanded && shell.activeDockTabId === 'notifications' },
    { id: 'toggle_panel', label: shell.isDockExpanded ? 'PANEL ON' : 'PANEL OFF', active: shell.isDockExpanded }
  ]
})

const latestNotifications = computed(() => notifications.latestItems)
</script>

<template>
  <div class="relative h-screen overflow-hidden bg-yd-app text-yd-text-primary">
    <div class="flex h-[calc(100%-2.25rem)] min-w-0 overflow-hidden">
      <div class="relative shrink-0">
        <ActivityRail
          :items="activityItems"
          :active-item-id="shell.activeWorkspaceId"
          @select="handleWorkspaceSelect"
          @open-settings="handleOpenSettings"
        />
      </div>

      <WorkspaceSidebar :title="workspaceTitle" :subtitle="workspaceSubtitle" class="h-full">
        <slot name="navigation">
          <div class="space-y-3">
            <div class="yd-panel-surface rounded-lg px-4 py-4">
              <div class="text-[10px] uppercase tracking-[0.22em] text-yd-text-muted yd-font-mono">
                Current Workspace
              </div>
              <div class="mt-2 text-sm font-semibold text-yd-text-primary">
                {{ shellContext.workspaceTitle }}
              </div>
              <div class="mt-2 text-xs text-yd-text-secondary">
                {{ shellContext.workspaceSubtitle }}
              </div>
            </div>

            <div class="yd-panel-surface rounded-lg px-4 py-4">
              <div class="text-[10px] uppercase tracking-[0.22em] text-yd-text-muted yd-font-mono">
                Source / Context
              </div>
              <div class="mt-2 text-sm text-yd-text-primary">
                {{ shellContext.sourceSummary ?? 'No cross-workspace source context active.' }}
              </div>
            </div>

            <div class="yd-panel-surface rounded-lg px-4 py-4">
              <div class="text-[10px] uppercase tracking-[0.22em] text-yd-text-muted yd-font-mono">
                Focus Entity
              </div>
              <div class="mt-2 text-sm font-semibold text-yd-text-primary">
                {{ shellContext.focusLabel }}
              </div>
              <div class="mt-2 text-xs text-yd-text-secondary">
                {{ shellContext.focusMeta }}
              </div>
            </div>

            <div class="yd-panel-surface rounded-lg px-4 py-4">
              <div class="text-[10px] uppercase tracking-[0.22em] text-yd-text-muted yd-font-mono">
                Quick Actions
              </div>
              <div class="mt-3 grid gap-2">
                <button
                  v-for="action in shellContext.quickActions"
                  :key="action.id"
                  type="button"
                  class="rounded-lg border border-yd-border-muted bg-yd-app px-3 py-2 text-left text-[11px] uppercase tracking-[0.16em] text-yd-text-primary transition-colors yd-font-mono disabled:cursor-not-allowed disabled:opacity-40"
                  :disabled="!action.enabled"
                  @click="handleShellAction(action.id)"
                >
                  {{ action.label }}
                </button>
              </div>
            </div>

            <div class="yd-panel-surface rounded-lg px-4 py-4">
              <div class="text-[10px] uppercase tracking-[0.22em] text-yd-text-muted yd-font-mono">
                Recent Targets
              </div>
              <div v-if="shellContext.recentTargets.length > 0" class="mt-3 grid gap-2">
                <button
                  v-for="target in shellContext.recentTargets"
                  :key="target.id"
                  type="button"
                  class="rounded-lg border border-yd-border-muted bg-yd-app px-3 py-2 text-left transition-colors hover:border-yd-state-accent"
                  @click="handleOpenRecentTarget(target.routePath)"
                >
                  <div class="text-xs font-semibold text-yd-text-primary">
                    {{ target.label }}
                  </div>
                  <div class="mt-1 text-[10px] uppercase tracking-[0.16em] text-yd-text-secondary yd-font-mono">
                    {{ target.meta }}
                  </div>
                </button>
              </div>
              <div v-else class="mt-2 text-xs text-yd-text-secondary">
                No recent targets recorded yet.
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
                status {{ runtime.statusFreshnessLabel }} · clock {{ runtime.clockFreshnessLabel }}
              </div>
            </div>
          </div>
        </slot>
      </WorkspaceSidebar>

      <div class="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <TopRuntimeBar class="shrink-0" />

        <main
          :ref="resolveDockBodyElement"
          class="min-h-0 flex-1 overflow-auto"
          :style="shell.isDockExpanded ? { paddingBottom: `${clampedDockHeight}px` } : undefined"
        >
          <slot />
        </main>

        <div v-if="shell.isDockExpanded" class="pointer-events-none absolute bottom-0 left-0 right-0 z-30">
          <BottomDock
            class="pointer-events-auto"
            :active-tab-id="shell.activeDockTabId"
            :tabs="panelTabs"
            :height="clampedDockHeight"
            :min-height="MIN_DOCK_HEIGHT"
            :max-height="availableDockHeight"
            @select="handlePanelTabSelect"
            @resize="handleDockResize"
          >
            <div v-if="shell.activeDockTabId === 'traces'" class="grid gap-3 lg:grid-cols-2">
              <button
                v-for="target in traceTargets"
                :key="target.id"
                type="button"
                class="rounded-md border border-yd-border-muted bg-yd-app px-3 py-3 text-left transition-colors hover:border-yd-state-accent"
                @click="handleOpenRecentTarget(target.routePath)"
              >
                <div class="text-[10px] uppercase tracking-[0.18em] text-yd-text-muted yd-font-mono">
                  Trace Context
                </div>
                <div class="mt-2 text-sm text-yd-text-primary">
                  {{ target.label }}
                </div>
                <div class="mt-2 text-xs text-yd-text-secondary">
                  {{ target.meta }}
                </div>
              </button>
              <div
                v-if="traceTargets.length === 0"
                class="rounded-md border border-yd-border-muted bg-yd-app px-3 py-3 text-xs text-yd-text-secondary"
              >
                No recent workflow trace context recorded yet.
              </div>
            </div>

            <div v-else-if="shell.activeDockTabId === 'jobs'" class="grid gap-3 lg:grid-cols-2">
              <button
                v-for="target in jobTargets"
                :key="target.id"
                type="button"
                class="rounded-md border border-yd-border-muted bg-yd-app px-3 py-3 text-left transition-colors hover:border-yd-state-accent"
                @click="handleOpenRecentTarget(target.routePath)"
              >
                <div class="text-[10px] uppercase tracking-[0.18em] text-yd-text-muted yd-font-mono">
                  Recent Target
                </div>
                <div class="mt-2 text-sm text-yd-text-primary">
                  {{ target.label }}
                </div>
                <div class="mt-2 text-xs text-yd-text-secondary">
                  {{ target.meta }}
                </div>
              </button>
              <div
                v-if="jobTargets.length === 0"
                class="rounded-md border border-yd-border-muted bg-yd-app px-3 py-3 text-xs text-yd-text-secondary"
              >
                No recent job-oriented targets recorded yet.
              </div>
            </div>

            <div v-else class="grid gap-3 lg:grid-cols-3">
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
    </div>

    <ShellSettingsMenu
      :open="isSettingsOpen"
      :runtime-label="settingsRuntimeLabel"
      :notifications-label="settingsNotificationsLabel"
      @close="isSettingsOpen = false"
    />

    <StatusBar
      class="relative z-20"
      :workspace-label="shellContext.workspaceTitle"
      :focus-label="shellContext.focusLabel"
      :runtime-summary="runtimeSummary"
      :notifications-summary="notificationsSummary"
      :panel-actions="statusBarActions"
      @action="handleStatusBarAction"
      @open-settings="handleOpenSettings"
    />
  </div>
</template>
