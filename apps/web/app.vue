<template>
  <n-config-provider :theme="darkTheme">
    <n-message-provider>
      <NuxtLayout>
        <div v-if="system.activeLayer === 'L2'" class="w-full h-full">
          <L2Graph :data="mockGraphData" />
        </div>
        <div v-else class="flex items-center justify-center h-full text-gray-500">
          <n-empty :description="`Layer ${system.activeLayer} is under development`" />
        </div>
      </NuxtLayout>
    </n-message-provider>
  </n-config-provider>
</template>

<script setup>
import { darkTheme, NConfigProvider, NMessageProvider, NEmpty } from 'naive-ui'
import { useClockStore } from '~/stores/clock'
import { useSystemStore } from '~/stores/system'
import { onMounted, onUnmounted, ref } from 'vue'

const clock = useClockStore()
const system = useSystemStore()

// Mock 数据用于测试 L2 Visualize
const mockGraphData = ref({
  nodes: [
    { data: { id: 'a', label: 'Agent Alpha', snr: 0.8, type: 'active', is_pinned: true } },
    { data: { id: 'b', label: 'Agent Beta', snr: 0.4, type: 'active', is_pinned: false } },
    { data: { id: 'n1', label: 'Noise_01', snr: 0.1, type: 'noise', is_pinned: false } },
    { data: { id: 'n2', label: 'Noise_02', snr: 0.15, type: 'noise', is_pinned: false } }
  ],
  edges: [
    { data: { id: 'ab', source: 'a', target: 'b', weight: 2, type: 'command' } },
    { data: { id: 'an1', source: 'a', target: 'n1', weight: 1, type: 'noise' } },
    { data: { id: 'bn2', source: 'b', target: 'n2', weight: 1, type: 'noise' } }
  ]
})

onMounted(() => {
  clock.startSync()
})

onUnmounted(() => {
  clock.stopSync()
})
</script>
