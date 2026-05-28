export default defineNuxtPlugin(() => {
  const config = useRuntimeConfig()
  const configuredApiBase = String(config.public.apiBase ?? '')

  const connectSrcValues = ["'self'"]
  const scriptSrcValues = ["'self'", "'unsafe-inline'"]

  if (configuredApiBase) {
    connectSrcValues.push(configuredApiBase)
    scriptSrcValues.push(configuredApiBase)
  }

  const directives: Record<string, string[]> = {
    'default-src': ["'self'"],
    'script-src': scriptSrcValues,
    'script-src-attr': ["'unsafe-inline'"],
    'style-src': ["'self'", "'unsafe-inline'"],
    'style-src-attr': ["'unsafe-inline'"],
    'connect-src': connectSrcValues,
    'worker-src': ["'self'", 'blob:'],
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
