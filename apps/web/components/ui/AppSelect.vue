<script setup lang="ts">
const model = defineModel<string>({ default: '' })
</script>

<template>
  <select
    v-model="model"
    class="mt-2 w-full rounded-sm border border-yd-border-strong bg-yd-app px-3 py-2 text-sm text-yd-text-primary outline-none transition-colors focus:border-yd-state-accent"
  >
    <slot />
  </select>
</template>
