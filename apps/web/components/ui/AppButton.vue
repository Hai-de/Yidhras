<script setup lang="ts">
import { computed } from 'vue'

const props = withDefaults(
  defineProps<{
    type?: 'button' | 'submit' | 'reset'
    variant?: 'primary' | 'secondary'
    size?: 'sm' | 'md'
    disabled?: boolean
    block?: boolean
  }>(),
  {
    type: 'button',
    variant: 'primary',
    size: 'md',
    disabled: false,
    block: false
  }
)

const baseClass =
  'rounded-sm border transition-colors bg-transparent yd-font-mono uppercase disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-yd-state-accent/60'

const variantClass = computed(() => {
  if (props.variant === 'secondary') {
    return 'border-yd-border-muted text-yd-text-secondary hover:border-yd-border-strong hover:bg-yd-elevated hover:text-yd-text-primary'
  }

  return 'border-yd-border-strong bg-yd-elevated text-yd-text-primary hover:border-yd-state-accent/60 hover:bg-yd-panel'
})

const sizeClass = computed(() => {
  if (props.size === 'sm') {
    return 'px-3 py-1.5 text-[11px] tracking-[0.16em]'
  }

  return 'px-4 py-2 text-[11px] tracking-[0.18em]'
})

const widthClass = computed(() => {
  return props.block ? 'w-full' : ''
})
</script>

<template>
  <button
    :type="props.type"
    :disabled="props.disabled"
    :class="[baseClass, variantClass, sizeClass, widthClass]"
  >
    <slot />
  </button>
</template>
