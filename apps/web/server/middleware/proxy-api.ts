const API_BASE = process.env.NUXT_PUBLIC_API_BASE ?? 'http://localhost:3001'

const API_RE = /^\/[^/]+\/api\//

export default defineEventHandler(async (event) => {
  const path = event.path

  const isGlobalApi = path.startsWith('/api/')
  const isPackScopedApi = API_RE.test(path)

  if (!isGlobalApi && !isPackScopedApi) return

  const base = API_BASE.replace(/\/$/, '')
  const target = `${base}${path}`

  try {
    return await proxyRequest(event, target)
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[proxy-api] Proxy request failed: ${target} — ${message}`);
    throw createError({ statusCode: 502, statusMessage: 'Bad Gateway', data: { proxy_error: message } });
  }
})