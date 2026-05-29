import { useRoute } from 'vue-router'

import { useRuntimeStore } from '../../stores/runtime'

export const resolvePackId = (): string | undefined => {
  // Prefer runtime store — works both during setup and in async callbacks.
  // useRoute() calls inject() internally, which logs warnings when invoked
  // outside component setup (e.g. from polling timers).
  const runtime = useRuntimeStore()
  const fromStore = runtime.worldPack?.instance_id ?? runtime.worldPack?.id
  if (fromStore) return fromStore

  try {
    const route = useRoute()
    const packId = route.params.packId as string | undefined
    if (packId) return packId
  } catch {
    // useRoute not available
  }

  return undefined
}
