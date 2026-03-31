import type { ApiClientError } from '../utils/api'
import { requestApiData } from '../utils/api'
import { defineStore } from 'pinia'

export interface WorldMetadata {
  id: string
  name: string
  version: string
  description?: string
}

interface RuntimeStatusResponse {
  status: 'running' | 'paused'
  runtime_ready: boolean
  health_level: 'ok' | 'degraded' | 'fail'
  world_pack: WorldMetadata | null
}

export const useSystemStore = defineStore('system', {
  state: () => ({
    status: 'idle' as 'idle' | 'running' | 'paused' | 'error',
    worldPack: null as WorldMetadata | null,
    activeLayer: 'L1' as 'L1' | 'L2' | 'L3' | 'L4',
    sidebarCollapsed: false
  }),
  actions: {
    setWorldPack(pack: WorldMetadata | null) {
      this.worldPack = pack
    },
    setStatus(status: 'idle' | 'running' | 'paused' | 'error') {
      this.status = status
    },
    switchLayer(layer: 'L1' | 'L2' | 'L3' | 'L4') {
      this.activeLayer = layer
    },
    async fetchRuntimeStatus() {
      try {
        const data = await requestApiData<RuntimeStatusResponse>('/api/status')
        this.status = data.runtime_ready ? data.status : 'error'
        this.worldPack = data.world_pack
      } catch (error) {
        const apiError = error as ApiClientError
        console.error('[SystemStore] Failed to fetch runtime status:', apiError)
        this.status = 'error'
      }
    }
  }
})
