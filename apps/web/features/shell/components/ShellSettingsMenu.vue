<script setup lang="ts">
const props = defineProps<{
  open: boolean
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
    class="absolute bottom-12 left-4 z-50 w-72 rounded-xl border border-yd-border-strong bg-yd-panel p-4 shadow-[0_16px_32px_rgba(0,0,0,0.32)]"
  >
    <div class="flex items-start justify-between gap-3">
      <div>
        <div class="text-[10px] uppercase tracking-[0.22em] text-yd-text-muted yd-font-mono">
          Operator Settings
        </div>
        <div class="mt-2 text-sm font-semibold text-yd-text-primary">
          Preferences & account surface
        </div>
      </div>
      <button
        type="button"
        class="rounded border border-yd-border-muted px-2 py-1 text-[10px] uppercase tracking-[0.18em] text-yd-text-secondary yd-font-mono"
        @click="emit('close')"
      >
        Close
      </button>
    </div>

    <div class="mt-4 space-y-3 text-sm text-yd-text-secondary">
      <div class="rounded-lg border border-yd-border-muted bg-yd-app px-3 py-3">
        Avatar, profile summary, theme switching, and operator preferences will be surfaced here instead of occupying a fixed rail slot.
      </div>
      <div class="rounded-lg border border-yd-border-muted bg-yd-app px-3 py-3">
        <div class="text-[10px] uppercase tracking-[0.16em] text-yd-text-muted yd-font-mono">
          Runtime Summary
        </div>
        <div class="mt-2 text-xs text-yd-text-primary">
          {{ props.runtimeLabel }}
        </div>
      </div>
      <div class="rounded-lg border border-yd-border-muted bg-yd-app px-3 py-3">
        <div class="text-[10px] uppercase tracking-[0.16em] text-yd-text-muted yd-font-mono">
          Notifications
        </div>
        <div class="mt-2 text-xs text-yd-text-primary">
          {{ props.notificationsLabel }}
        </div>
      </div>
    </div>
  </div>
</template>
