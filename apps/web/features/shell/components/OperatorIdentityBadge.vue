<script setup lang="ts">
const props = withDefaults(
  defineProps<{
    name?: string
    role?: string
    avatarLabel?: string
  }>(),
  {
    name: 'Operator',
    role: 'SYSTEM OPERATOR',
    avatarLabel: 'OP'
  }
)
</script>

<template>
  <div class="yd-panel-surface flex items-center gap-3 rounded-lg px-3 py-3">
    <div
      class="flex h-10 w-10 items-center justify-center rounded-md border border-yd-border-strong bg-yd-elevated text-sm font-semibold text-yd-text-primary yd-font-mono"
    >
      {{ props.avatarLabel }}
    </div>
    <div class="min-w-0">
      <div class="truncate text-sm font-semibold text-yd-text-primary">
        {{ props.name }}
      </div>
      <div class="truncate text-[10px] uppercase tracking-[0.2em] text-yd-text-muted yd-font-mono">
        {{ props.role }}
      </div>
    </div>
  </div>
</template>
