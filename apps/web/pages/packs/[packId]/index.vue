<template>
  <div />
</template>

<script setup lang="ts">
const route = useRoute()
const packId = route.params.packId as string
await navigateTo(`/packs/${packId}/overview`, { replace: true })
</script>
