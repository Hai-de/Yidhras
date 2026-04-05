<script setup lang="ts">
const props = defineProps<{
  open: boolean
  anchorStyle: Record<string, string>
  runtimeLabel: string
  notificationsLabel: string
}>()

const emit = defineEmits<{
  close: []
}>()
</script>

<template>
  <div
    v-if="props.open"
    class="yd-shell-settings-menu fixed z-[70] max-h-[calc(100vh-1.5rem)] w-72 overflow-y-auto rounded-md border border-yd-border-muted/70 bg-yd-elevated p-3 shadow-[0_12px_28px_rgba(0,0,0,0.24)]"
    :style="props.anchorStyle"
    role="dialog"
    aria-label="Operator settings"
  >
    <div class="yd-separator-bottom flex items-start justify-between gap-3 pb-3">
      <div>
        <div class="text-[10px] uppercase tracking-[0.16em] text-yd-text-muted yd-font-mono">
          Operator Settings
        </div>
        <div class="mt-2 text-sm font-semibold text-yd-text-primary">
          Preferences & account surface
        </div>
      </div>
      <button
        type="button"
        class="rounded-sm border border-transparent px-2 py-1 text-[10px] uppercase tracking-[0.14em] text-yd-text-secondary yd-font-mono transition-colors hover:bg-yd-panel hover:text-yd-text-primary"
        @click="emit('close')"
      >
        Close
      </button>
    </div>

    <div class="mt-3 space-y-2.5 text-sm text-yd-text-secondary">
      <div class="yd-workbench-inset rounded-sm px-3 py-3 leading-6">
        Avatar, profile summary, theme switching, and operator preferences will be surfaced here instead of occupying a fixed rail slot.
      </div>
      <div class="yd-workbench-inset rounded-sm px-3 py-3">
        <div class="text-[10px] uppercase tracking-[0.14em] text-yd-text-muted yd-font-mono">
          Runtime Summary
        </div>
        <div class="mt-2 text-xs text-yd-text-primary">
          {{ props.runtimeLabel }}
        </div>
      </div>
      <div class="yd-workbench-inset rounded-sm px-3 py-3">
        <div class="text-[10px] uppercase tracking-[0.14em] text-yd-text-muted yd-font-mono">
          Notifications
        </div>
        <div class="mt-2 text-xs text-yd-text-primary">
          {{ props.notificationsLabel }}
        </div>
      </div>
    </div>
  </div>
</template>
