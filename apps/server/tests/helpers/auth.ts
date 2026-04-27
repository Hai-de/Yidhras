import { requestJson } from './server.js'

export interface AuthHeaders {
  'Content-Type': string
  Authorization: string
  'x-m2-identity'?: string
}

let cachedRootToken: string | null = null

/**
 * 登录为 root operator 并返回包含 Bearer token 的请求头。
 * token 在进程生命周期内缓存。
 */
export const getRootAuthHeaders = async (baseUrl: string): Promise<AuthHeaders> => {
  if (!cachedRootToken) {
    const response = await requestJson(baseUrl, '/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: 'root',
        password: process.env.ROOT_PASSWORD || 'changeme-root-password'
      })
    })

    if (response.status !== 200) {
      throw new Error(
        `Root login failed (status=${response.status}): ${JSON.stringify(response.body)}`
      )
    }

    const body = response.body as Record<string, unknown>
    const data = body.data as Record<string, unknown>
    cachedRootToken = data.token as string
  }

  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${cachedRootToken}`
  }
}

/**
 * 返回带 x-m2-identity 头的认证请求头（root operator 可代理为指定身份）。
 */
export const getRootAuthHeadersWithIdentity = async (
  baseUrl: string,
  identityId: string,
  type: 'agent' | 'user' | 'system' = 'agent'
): Promise<AuthHeaders> => {
  const headers = await getRootAuthHeaders(baseUrl)
  return {
    ...headers,
    'x-m2-identity': JSON.stringify({ id: identityId, type, name: identityId })
  }
}

export const clearCachedToken = (): void => {
  cachedRootToken = null
}
