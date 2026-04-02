<script setup lang="ts">
const props = withDefaults(
  defineProps<{
    elevated?: boolean
    padded?: boolean
  }>(),
  {
    elevated: false,
    padded: false
  }
)
</script>

<template>
  <div
    :class="[
      props.elevated ? 'yd-panel-surface--elevated' : 'yd-panel-surface',
      'rounded-md',
      props.padded ? 'px-4 py-4' : ''
    ]"
  >
    <slot />
  </div>
</template>
