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
  } catch {
    throw createError({ statusCode: 502, statusMessage: 'Bad Gateway' })
  }
})