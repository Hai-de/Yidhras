<script setup lang="ts">
import { computed } from 'vue'

import { useOperatorBootstrap } from '../../../composables/app/useOperatorBootstrap'
import { useNotificationsStore } from '../../../stores/notifications'
import { useRuntimeStore } from '../../../stores/runtime'
import { useShellStore } from '../../../stores/shell'

const runtime = useRuntimeStore()
const notifications = useNotificationsStore()
const shell = useShellStore()
const operatorBootstrap = useOperatorBootstrap()

const runtimeStatusLabel = computed(() => {
  if (runtime.status === 'error') {
    return runtime.runtimeReady ? 'runtime degraded' : 'runtime unavailable'
  }

  if (runtime.healthLevel === 'degraded') {
    return 'runtime degraded'
  }

  return runtime.runtimeReady ? 'runtime ready' : 'runtime booting'
})

const runtimeStatusClass = computed(() => {
  if (runtime.status === 'error') {
    return 'border-yd-state-danger/40 text-yd-state-danger'
  }

  if (runtime.healthLevel === 'degraded') {
    return 'border-yd-state-warning/40 text-yd-state-warning'
  }

  return 'border-yd-state-success/40 text-yd-state-success'
})

const runtimeSpeedLabel = computed(() => {
  const effectiveStepTicks = runtime.runtimeSpeed?.effective_step_ticks ?? 'n/a'
  return `${runtime.status} · ${effectiveStepTicks} tick/step`
})

const runtimeSyncSummary = computed(() => {
  return `clock ${runtime.clockFreshnessLabel} · status ${runtime.statusFreshnessLabel}`
})

const notificationsSummary = computed(() => {
  return `${notifications.errorCount} error · ${notifications.warningCount} warning · ${notifications.unreadCount} total`
})

const notificationsStatusClass = computed(() => {
  if (notifications.errorCount > 0) {
    return 'text-yd-state-danger'
  }

  if (notifications.warningCount > 0) {
    return 'text-yd-state-warning'
  }

  return 'text-yd-text-secondary'
})

const dockToggleLabel = computed(() => {
  return shell.isDockExpanded ? 'Hide Dock' : 'Show Dock'
})

const handleRefreshAll = async () => {
  await operatorBootstrap.refreshAll()
}
</script>

<template>
  <header class="yd-toolbar-surface yd-separator-bottom flex min-h-16 items-center justify-between border-x-0 border-t-0 px-4 py-3">
    <div class="flex min-w-0 items-center gap-6">
      <div class="min-w-0">
        <div class="text-[10px] uppercase tracking-[0.16em] text-yd-text-muted yd-font-mono">
          World State
        </div>
        <div class="mt-1.5 flex min-w-0 items-center gap-3">
          <span
            class="yd-status-pill rounded-sm text-[10px] uppercase tracking-[0.14em] yd-font-mono"
            :class="runtimeStatusClass"
          >
            {{ runtimeStatusLabel }}
          </span>
          <span class="truncate text-xs text-yd-text-secondary">
            {{ runtime.worldPack?.name ?? 'No world pack loaded' }}
          </span>
        </div>
        <div class="mt-1 text-[11px] text-yd-text-muted yd-font-mono">
          {{ runtimeSyncSummary }}
        </div>
      </div>

      <div class="hidden min-w-0 lg:block">
        <div class="text-[10px] uppercase tracking-[0.16em] text-yd-text-muted yd-font-mono">
          Time Scale
        </div>
        <div class="mt-1 text-sm text-yd-text-primary yd-font-mono">
          {{ runtime.formattedTicks }}
        </div>
        <div class="text-xs text-yd-text-secondary">
          {{ runtime.primaryCalendarTime }}
        </div>
      </div>
    </div>

    <div class="flex items-center gap-4">
      <div class="hidden items-center gap-5 xl:flex">
        <div>
          <div class="text-[10px] uppercase tracking-[0.16em] text-yd-text-muted yd-font-mono">
            Runtime Speed
          </div>
          <div class="mt-1 text-xs text-yd-text-primary yd-font-mono">
            {{ runtimeSpeedLabel }}
          </div>
        </div>

        <div>
          <div class="text-[10px] uppercase tracking-[0.16em] text-yd-text-muted yd-font-mono">
            Notifications
          </div>
          <div class="mt-1 text-xs yd-font-mono" :class="notificationsStatusClass">
            {{ notificationsSummary }}
          </div>
        </div>
      </div>

      <div class="flex items-center gap-2 pl-4 xl:ml-1 xl:border-l xl:border-yd-border-muted/50">
        <button
          type="button"
          class="rounded-sm border border-yd-border-muted bg-yd-elevated px-3.5 py-2 text-[11px] uppercase tracking-[0.12em] text-yd-text-primary yd-font-mono transition-colors hover:border-yd-border-strong hover:bg-yd-panel"
          @click="handleRefreshAll"
        >
          Refresh All
        </button>
        <button
          type="button"
          class="rounded-sm border border-transparent bg-transparent px-3 py-2 text-[11px] uppercase tracking-[0.12em] text-yd-text-secondary yd-font-mono transition-colors hover:bg-yd-elevated hover:text-yd-text-primary"
          @click="shell.toggleDockExpanded()"
        >
          {{ dockToggleLabel }}
        </button>
      </div>
    </div>
  </header>
</template>
