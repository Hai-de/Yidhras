import { useRuntimeStore } from '../../stores/runtime'

export const resolvePackId = (): string | undefined => {
  const runtime = useRuntimeStore()
  return runtime.worldPack?.instance_id ?? runtime.worldPack?.id
}
