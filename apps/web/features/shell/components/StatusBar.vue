<script setup lang="ts">
interface StatusBarAction {
  id: string
  label: string
  active?: boolean
}

const props = defineProps<{
  workspaceLabel: string
  focusLabel: string
  runtimeSummary: string
  notificationsSummary: string
  panelActions: ReadonlyArray<StatusBarAction>
}>()

const emit = defineEmits<{
  action: [actionId: string]
  openSettings: []
}>()
</script>

<template>
  <footer class="yd-separator-top flex h-8 shrink-0 items-center justify-between bg-yd-panel px-3 text-[11px] text-yd-text-secondary">
    <div class="flex min-w-0 items-center gap-3">
      <button
        type="button"
        class="rounded-sm border border-transparent px-1.5 py-0.5 text-[10px] uppercase tracking-[0.14em] text-yd-text-muted transition-colors hover:bg-yd-elevated hover:text-yd-text-primary yd-font-mono"
        @click="emit('openSettings')"
      >
        Settings
      </button>
      <div class="h-3 w-px shrink-0 bg-yd-border-muted/45" />
      <div class="truncate text-[10px] uppercase tracking-[0.14em] text-yd-text-muted yd-font-mono">
        {{ props.workspaceLabel }}
      </div>
      <div class="hidden truncate text-xs text-yd-text-secondary xl:block">
        {{ props.focusLabel }}
      </div>
    </div>

    <div class="flex min-w-0 items-center gap-1.5">
      <button
        v-for="action in props.panelActions"
        :key="action.id"
        type="button"
        class="rounded-sm border border-transparent px-2 py-0.5 text-[10px] uppercase tracking-[0.12em] transition-colors yd-font-mono"
        :class="action.active
          ? 'bg-yd-elevated text-yd-text-primary'
          : 'text-yd-text-muted hover:bg-yd-elevated hover:text-yd-text-primary'"
        @click="emit('action', action.id)"
      >
        {{ action.label }}
      </button>
      <div class="hidden h-3 w-px shrink-0 bg-yd-border-muted/45 lg:block" />
      <div class="hidden text-[10px] uppercase tracking-[0.12em] text-yd-text-muted yd-font-mono lg:block">
        {{ props.runtimeSummary }}
      </div>
      <div class="hidden text-[10px] uppercase tracking-[0.12em] text-yd-text-muted yd-font-mono xl:block">
        {{ props.notificationsSummary }}
      </div>
    </div>
  </footer>
</template>
