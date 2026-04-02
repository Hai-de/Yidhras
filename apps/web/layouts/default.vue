<template>
  <AppShell>
    <template #default>
      <slot />
    </template>
  </AppShell>
</template>

<script setup lang="ts">
import AppShell from '../features/shell/components/AppShell.vue'
</script>
