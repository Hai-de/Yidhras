<script setup lang="ts">
import { useAuthStore } from '~/stores/auth'

const auth = useAuthStore()

if (auth.isAuthenticated) {
  await navigateTo('/packs', { replace: true })
} else {
  await navigateTo('/login', { replace: true })
}
</script>

<template>
  <div />
</template>
