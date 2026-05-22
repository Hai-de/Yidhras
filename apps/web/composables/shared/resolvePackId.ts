import { useRoute } from 'vue-router'

import { useRuntimeStore } from '../../stores/runtime'

export const resolvePackId = (): string | undefined => {
  try {
    const route = useRoute()
    const packId = route.params.packId as string | undefined
    if (packId) return packId
  } catch {
    // useRoute not available (e.g. during SSR or outside component context)
  }

  const runtime = useRuntimeStore()
  return runtime.worldPack?.instance_id
}
