import { useToast } from '#imports'

export type AppToastLevel = 'info' | 'warning' | 'error' | 'success'

export interface AppToastOptions {
  duration?: number
  keepAliveOnHover?: boolean
}

export interface AppToastApi {
  error: (content: string, options?: AppToastOptions) => void
  info: (content: string, options?: AppToastOptions) => void
  show: (level: AppToastLevel, content: string, options?: AppToastOptions) => void
  success: (content: string, options?: AppToastOptions) => void
  warning: (content: string, options?: AppToastOptions) => void
}

const resolveToastColor = (level: AppToastLevel) => {
  if (level === 'error') return 'error'
  if (level === 'warning') return 'warning'
  if (level === 'success') return 'success'
  return 'info'
}

export const useAppToast = (): AppToastApi => {
  const toast = useToast()

  const show = (level: AppToastLevel, content: string, options?: AppToastOptions) => {
    toast.add({
      title: content,
      color: resolveToastColor(level),
      duration: options?.duration
    })
  }

  return {
    show,
    info: (content, options) => show('info', content, options),
    warning: (content, options) => show('warning', content, options),
    error: (content, options) => show('error', content, options),
    success: (content, options) => show('success', content, options)
  }
}
