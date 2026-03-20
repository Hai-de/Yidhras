<script setup lang="ts">
import { useClockStore } from '../stores/clock'
import { useSystemStore } from '../stores/system'

const clock = useClockStore()
const system = useSystemStore()

const layers = [
  { id: 'L1', name: 'Social' },
  { id: 'L2', name: 'Relational' },
  { id: 'L3', name: 'Narrative' },
  { id: 'L4', name: 'Transmission' }
] as const
</script>

<template>
  <div class="flex h-screen w-screen overflow-hidden bg-[#1e1e20]">
    <!-- 第一栏: Icon Bar (类 Discord) -->
    <aside class="flex w-16 flex-col items-center bg-[#131314] py-4 space-y-4">
      <div class="h-12 w-12 rounded-2xl bg-indigo-600 flex items-center justify-center cursor-pointer hover:rounded-xl transition-all duration-300">
        <span class="text-xl font-bold">Y</span>
      </div>
      <div class="w-8 h-[2px] bg-gray-700"></div>
      
      <!-- 层级切换按钮 -->
      <div v-for="layer in layers" :key="layer.id" 
           @click="system.switchLayer(layer.id)"
           class="h-12 w-12 rounded-3xl bg-gray-800 cursor-pointer hover:rounded-xl transition-all duration-300 flex items-center justify-center text-sm font-bold"
           :class="[system.activeLayer === layer.id ? 'bg-indigo-500 text-white rounded-xl' : 'text-gray-400 hover:bg-gray-700 hover:text-white']">
        {{ layer.id }}
      </div>
    </aside>

    <!-- 第二栏: Nav Panel -->
    <nav class="flex w-64 flex-col bg-[#1e1e20] border-r border-gray-800">
      <div class="h-12 flex items-center px-4 border-b border-gray-800 font-semibold text-gray-300">
        {{ system.activeLayer }} EXPLORER
      </div>
      <div class="flex-1 overflow-y-auto p-2">
        <slot name="navigation">
          <div class="text-xs font-bold text-gray-500 px-2 py-2 uppercase">{{ system.activeLayer }} Components</div>
          <div v-for="item in 5" :key="item"
               class="px-2 py-1.5 rounded hover:bg-gray-800 cursor-pointer text-sm text-gray-400 hover:text-white transition-colors">
            Component {{ system.activeLayer }}.{{ item }}
          </div>
        </slot>
      </div>
    </nav>

    <!-- 第三栏: Main View -->
    <main class="flex-1 flex flex-col min-w-0 bg-[#0f0f10]">
      <!-- Top Bar: Clock & Status -->
      <header class="h-12 flex items-center justify-between px-6 border-b border-gray-800 bg-[#1e1e20]">
        <div class="flex items-center space-x-6">
          <div class="flex flex-col">
            <span class="text-[10px] text-gray-500 uppercase font-bold tracking-tighter">Absolute Tick</span>
            <span class="text-sm font-mono text-indigo-400 leading-none">{{ clock.formattedTicks }}</span>
          </div>
          <div class="flex flex-col">
            <span class="text-[10px] text-gray-500 uppercase font-bold tracking-tighter">Current Timeline</span>
            <span class="text-xs text-gray-300 leading-none">{{ clock.primaryCalendarTime }}</span>
          </div>
        </div>
        <div class="flex items-center space-x-3">
          <div class="flex items-center space-x-2 bg-black/30 px-3 py-1 rounded-full border border-gray-800">
            <div class="w-2 h-2 rounded-full" :class="[system.status === 'running' ? 'bg-green-500 animate-pulse' : 'bg-yellow-500']"></div>
            <span class="text-[10px] text-gray-400 uppercase tracking-widest">{{ system.status }}</span>
          </div>
          <div class="text-xs text-gray-600 font-mono">v0.1.0-alpha</div>
        </div>
      </header>

      <!-- Content Area -->
      <div class="flex-1 overflow-hidden relative">
        <slot />
      </div>
    </main>
  </div>
</template>
