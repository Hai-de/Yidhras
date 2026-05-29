import { useRouter } from 'vue-router'

export interface ShellNavigation {
  switchPack: (packId: string) => Promise<void>
  goToPacks: () => Promise<void>
}

export const useShellNavigation = (): ShellNavigation => {
  const router = useRouter()
  const localePath = useLocalePath()

  return {
    switchPack: async (packId: string) => {
      await router.push(localePath(`/packs/${packId}`))
    },
    goToPacks: async () => {
      await router.push(localePath('/packs'))
    }
  }
}
