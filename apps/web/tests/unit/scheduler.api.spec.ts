import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useSchedulerApi } from '../../composables/api/useSchedulerApi'

const requestApiDataMock = vi.fn()

vi.mock('../../lib/http/client', () => ({
  requestApiData: (...args: unknown[]): unknown => requestApiDataMock(...args)
}))

describe('useSchedulerApi', () => {
  beforeEach(() => {
    requestApiDataMock.mockReset()
    requestApiDataMock.mockResolvedValue(null)
  })

  it('builds scheduler operator projection query', async () => {
    const api = useSchedulerApi()

    await api.getOperatorProjection({ sampleRuns: 12, recentLimit: 6 })

    expect(requestApiDataMock).toHaveBeenCalledWith('/api/runtime/scheduler/operator?sample_runs=12&recent_limit=6')
  })

  it('builds scheduler ownership, workers, and rebalance queries', async () => {
    const api = useSchedulerApi()

    await api.listOwnershipAssignments({ workerId: 'worker-a', partitionId: 'p2', status: 'assigned' })
    await api.listWorkers({ workerId: 'worker-a', status: 'active' })
    await api.listRebalanceRecommendations({
      limit: 5,
      workerId: 'worker-a',
      partitionId: 'p2',
      status: 'applied',
      suppressReason: 'worker_unhealthy'
    })

    expect(requestApiDataMock).toHaveBeenNthCalledWith(
      1,
      '/api/runtime/scheduler/ownership?worker_id=worker-a&partition_id=p2&status=assigned'
    )
    expect(requestApiDataMock).toHaveBeenNthCalledWith(2, '/api/runtime/scheduler/workers?worker_id=worker-a&status=active')
    expect(requestApiDataMock).toHaveBeenNthCalledWith(
      3,
      '/api/runtime/scheduler/rebalance/recommendations?limit=5&worker_id=worker-a&partition_id=p2&status=applied&suppress_reason=worker_unhealthy'
    )
  })

  it('builds scheduler agent projection query', async () => {
    const api = useSchedulerApi()

    await api.getAgentProjection('agent-9', { limit: 20 })

    expect(requestApiDataMock).toHaveBeenCalledWith('/api/agent/agent-9/scheduler/projection?limit=20')
  })
})
