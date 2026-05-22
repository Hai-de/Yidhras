import { requestApiData } from '../../lib/http/client'

export type PackOperationResult = {
  acknowledged?: boolean
  [key: string]: unknown
}

const encodePackId = (instanceId: string): string => encodeURIComponent(instanceId)

export const usePackOperationsApi = () => {
  return {
    loadPack: (instanceId: string) =>
      requestApiData<PackOperationResult>(`/api/experimental/runtime/packs/${encodePackId(instanceId)}/load`, {
        method: 'POST'
      }),

    unloadPack: (instanceId: string) =>
      requestApiData<PackOperationResult>(`/api/experimental/runtime/packs/${encodePackId(instanceId)}/unload`, {
        method: 'POST'
      }),

    stepPack: (instanceId: string, amount = 1) =>
      requestApiData<PackOperationResult>(`/api/experimental/runtime/packs/${encodePackId(instanceId)}/step`, {
        method: 'POST',
        body: { amount }
      }),

    getRuntimeStatus: (instanceId: string) =>
      requestApiData<PackOperationResult>(`/api/experimental/runtime/packs/${encodePackId(instanceId)}/status`),

    getRuntimeClock: (instanceId: string) =>
      requestApiData<PackOperationResult>(`/api/experimental/runtime/packs/${encodePackId(instanceId)}/clock`),

    listRuntimePacks: () =>
      requestApiData<PackOperationResult>('/api/experimental/runtime/packs')
  }
}
