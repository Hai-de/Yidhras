import { defineStore } from 'pinia'

import type { ApiClientError } from '../lib/http/client'
import { requestApiData } from '../lib/http/client'
import type { TickString } from '../lib/time/tick'

export interface WorldMetadata {
  id: string
  name: string
  version: string
  description?: string
}

export interface RuntimeSpeedSnapshot {
  mode: 'fixed'
  source: 'default' | 'world_pack' | 'override'
  configured_step_ticks: TickString | null
  override_step_ticks: TickString | null
  override_since: number | null
  effective_step_ticks: TickString
}

interface RuntimeStatusResponse {
  status: 'running' | 'paused'
  runtime_ready: boolean
  runtime_speed: RuntimeSpeedSnapshot
  health_level: 'ok' | 'degraded' | 'fail'
  world_pack: WorldMetadata | null
  has_error: boolean
  startup_errors: string[]
}

export const useSystemStore = defineStore('system', {
  state: () => ({
    status: 'idle' as 'idle' | 'running' | 'paused' | 'error',
    worldPack: null as WorldMetadata | null,
    healthLevel: 'ok' as 'ok' | 'degraded' | 'fail',
    runtimeReady: false,
    runtimeSpeed: null as RuntimeSpeedSnapshot | null,
    startupErrors: [] as string[],
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
        this.healthLevel = data.health_level
        this.runtimeReady = data.runtime_ready
        this.runtimeSpeed = data.runtime_speed
        this.startupErrors = data.startup_errors
      } catch (error) {
        const apiError = error as ApiClientError
        console.error('[SystemStore] Failed to fetch runtime status:', apiError)
        this.status = 'error'
        this.runtimeReady = false
        this.runtimeSpeed = null
      }
    }
  }
})
