import { defineStore } from 'pinia'

export interface WorldMetadata {
  id: string
  name: string
  version: string
  description?: string
}

export const useSystemStore = defineStore('system', {
  state: () => ({
    status: 'idle' as 'idle' | 'running' | 'paused' | 'error',
    worldPack: null as WorldMetadata | null,
    activeLayer: 'L1' as 'L1' | 'L2' | 'L3' | 'L4',
    sidebarCollapsed: false
  }),
  actions: {
    setWorldPack(pack: WorldMetadata) {
      this.worldPack = pack
    },
    setStatus(status: 'idle' | 'running' | 'paused' | 'error') {
      this.status = status
    },
    switchLayer(layer: 'L1' | 'L2' | 'L3' | 'L4') {
      this.activeLayer = layer
    }
  }
})
