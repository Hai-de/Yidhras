import { useRouteQuery } from '@vueuse/router'
import { computed } from 'vue'

const normalizeAgentTab = (value: string | null | undefined) => {
  switch (value) {
    case 'relations':
    case 'posts':
    case 'workflows':
    case 'memory':
      return value
    default:
      return 'overview'
  }
}

export const useAgentRouteState = () => {
  const tabQuery = useRouteQuery<string | null>('tab', null, { mode: 'replace' })

  const activeTab = computed(() => normalizeAgentTab(tabQuery.value))

  const setActiveTab = (tab: 'overview' | 'relations' | 'posts' | 'workflows' | 'memory') => {
    tabQuery.value = tab === 'overview' ? null : tab
  }

  return {
    activeTab,
    setActiveTab
  }
}
