<script setup lang="ts">
import { computed } from 'vue'

type AppButtonKind = 'command' | 'toolbar' | 'plain' | 'ghost'

const props = withDefaults(
  defineProps<{
    type?: 'button' | 'submit' | 'reset'
    variant?: 'primary' | 'secondary'
    kind?: AppButtonKind
    size?: 'sm' | 'md'
    disabled?: boolean
    block?: boolean
  }>(),
  {
    type: 'button',
    variant: 'primary',
    kind: 'command',
    size: 'md',
    disabled: false,
    block: false
  }
)

const baseClass =
  'inline-flex items-center justify-center rounded-sm border transition-colors disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-yd-state-accent/60'

const typographyClass = computed(() => {
  if (props.kind === 'plain' || props.kind === 'ghost') {
    return 'yd-font-sans normal-case tracking-normal'
  }

  return 'yd-font-mono uppercase'
})

const variantClass = computed(() => {
  if (props.kind === 'ghost') {
    return props.variant === 'secondary'
      ? 'border-transparent bg-transparent text-yd-text-secondary hover:bg-yd-elevated hover:text-yd-text-primary'
      : 'border-transparent bg-transparent text-yd-text-primary hover:bg-yd-elevated'
  }

  if (props.kind === 'toolbar') {
    return props.variant === 'secondary'
      ? 'border-transparent bg-transparent text-yd-text-secondary hover:bg-yd-elevated hover:text-yd-text-primary'
      : 'border-yd-border-muted bg-transparent text-yd-text-primary hover:border-yd-border-strong hover:bg-yd-elevated'
  }

  if (props.kind === 'plain') {
    return props.variant === 'secondary'
      ? 'border-yd-border-muted bg-transparent text-yd-text-secondary hover:border-yd-border-strong hover:bg-yd-elevated hover:text-yd-text-primary'
      : 'border-yd-border-muted bg-yd-elevated text-yd-text-primary hover:border-yd-border-strong hover:bg-yd-panel'
  }

  return props.variant === 'secondary'
    ? 'border-yd-border-muted text-yd-text-secondary hover:border-yd-border-strong hover:bg-yd-elevated hover:text-yd-text-primary'
    : 'border-yd-border-strong bg-yd-elevated text-yd-text-primary hover:border-yd-state-accent/60 hover:bg-yd-panel'
})

const sizeClass = computed(() => {
  if (props.kind === 'plain' || props.kind === 'ghost') {
    return props.size === 'sm' ? 'px-3 py-1.5 text-sm' : 'px-4 py-2 text-sm'
  }

  if (props.kind === 'toolbar') {
    return props.size === 'sm' ? 'px-3 py-1.5 text-[10px] tracking-[0.12em]' : 'px-3 py-2 text-[10px] tracking-[0.12em]'
  }

  return props.size === 'sm' ? 'px-3 py-1.5 text-[11px] tracking-[0.14em]' : 'px-4 py-2 text-[11px] tracking-[0.14em]'
})

const widthClass = computed(() => {
  return props.block ? 'w-full' : ''
})
</script>

<template>
  <button
    :type="props.type"
    :disabled="props.disabled"
    :class="[baseClass, typographyClass, variantClass, sizeClass, widthClass]"
  >
    <slot />
  </button>
</template>
