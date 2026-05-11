export default defineNuxtPlugin(() => {
  const config = useRuntimeConfig()
  const apiBase: string = (config.public.apiBase as string) || 'http://localhost:3001'

  const directives: Record<string, string[]> = {
    'default-src': ["'self'"],
    'script-src': ["'self'", "'unsafe-inline'"],
    'script-src-attr': ["'unsafe-inline'"],
    'style-src': ["'self'", "'unsafe-inline'"],
    'style-src-attr': ["'unsafe-inline'"],
    'connect-src': ["'self'", apiBase],
    'img-src': ["'self'", 'data:', 'blob:'],
    'font-src': ["'self'", 'data:'],
    'base-uri': ["'self'"],
    'form-action': ["'self'"],
    'object-src': ["'none'"]
  }

  const cspString = Object.entries(directives)
    .map(([key, values]) => `${key} ${values.join(' ')}`)
    .join('; ')

  useHead({ meta: [{ 'http-equiv': 'Content-Security-Policy', content: cspString }] })
})
