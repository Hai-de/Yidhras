<script setup lang="ts">
const props = withDefaults(
  defineProps<{
    items: string[]
    activeItem: string
    compact?: boolean
  }>(),
  {
    compact: false
  }
)

const emit = defineEmits<{
  change: [item: string]
}>()
</script>

<template>
  <div class="yd-separator-bottom flex flex-wrap items-end gap-1" role="tablist">
    <button
      v-for="item in props.items"
      :key="item"
      type="button"
      role="tab"
      :aria-selected="props.activeItem === item"
      class="-mb-px inline-flex items-center rounded-t-sm border-b-2 px-3 text-[11px] uppercase tracking-[0.12em] transition-colors yd-font-mono"
      :class="[
        props.compact ? 'h-8' : 'h-9',
        props.activeItem === item
          ? 'border-yd-state-accent bg-yd-panel text-yd-text-primary'
          : 'border-transparent text-yd-text-muted hover:border-yd-border-strong hover:text-yd-text-primary'
      ]"
      @click="emit('change', item)"
    >
      {{ item }}
    </button>
  </div>
</template>
