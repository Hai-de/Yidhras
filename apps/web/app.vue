<template>
  <AppNotificationsBridge />
  <NuxtLayout>
    <NuxtPage />
  </NuxtLayout>
</template>

<script setup>
import { useOperatorBootstrap } from './composables/app/useOperatorBootstrap'
import AppNotificationsBridge from './features/shared/components/AppNotificationsBridge.vue'

useOperatorBootstrap()
</script>
