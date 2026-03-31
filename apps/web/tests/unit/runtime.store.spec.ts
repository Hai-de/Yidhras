import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'

import { useRuntimeStore } from '../../stores/runtime'

describe('useRuntimeStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('applies clock snapshot and formats tick strings', () => {
    const runtime = useRuntimeStore()

    runtime.applyClockSnapshot({
      absolute_ticks: '42',
      calendars: [{ display: 'Cycle 42' }]
    })

    expect(runtime.absoluteTicks).toBe('42')
    expect(runtime.formattedTicks).toBe('000000042')
    expect(runtime.primaryCalendarTime).toBe('Cycle 42')
    expect(runtime.lastClockSyncedAt).toEqual(expect.any(Number))
  })

  it('applies runtime status snapshot and exposes status helpers', () => {
    const runtime = useRuntimeStore()

    runtime.applyRuntimeStatusSnapshot({
      status: 'running',
      runtime_ready: true,
      runtime_speed: {
        mode: 'fixed',
        source: 'default',
        configured_step_ticks: '1',
        override_step_ticks: null,
        override_since: null,
        effective_step_ticks: '3'
      },
      health_level: 'degraded',
      world_pack: {
        id: 'pack-alpha',
        name: 'Pack Alpha',
        version: '0.1.0'
      },
      has_error: false,
      startup_errors: ['late init']
    })

    expect(runtime.status).toBe('running')
    expect(runtime.runtimeReady).toBe(true)
    expect(runtime.healthLevel).toBe('degraded')
    expect(runtime.worldPack?.name).toBe('Pack Alpha')
    expect(runtime.runtimeSpeed?.effective_step_ticks).toBe('3')
    expect(runtime.hasStartupErrors).toBe(true)
    expect(runtime.hasRuntimeError).toBe(false)
  })
})
