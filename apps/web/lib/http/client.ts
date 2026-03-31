import type { ApiEnvelope, ApiFailure, ApiSuccess } from '@yidhras/contracts'

import { useRuntimeConfig } from '#imports'

export class ApiClientError extends Error {
  code: string
  requestId?: string
  details?: unknown
  status?: number

  constructor(options: {
    message: string
    code: string
    requestId?: string
    details?: unknown
    status?: number
  }) {
    super(options.message)
    this.name = 'ApiClientError'
    this.code = options.code
    this.requestId = options.requestId
    this.details = options.details
    this.status = options.status
  }
}

export type ApiClientMethod =
  | 'GET'
  | 'POST'
  | 'PUT'
  | 'PATCH'
  | 'DELETE'
  | 'HEAD'
  | 'OPTIONS'
  | 'get'
  | 'post'
  | 'put'
  | 'patch'
  | 'delete'
  | 'head'
  | 'options'

export interface ApiClientOptions {
  method?: ApiClientMethod
  headers?: HeadersInit
  body?: BodyInit | Record<string, unknown>
  baseURL?: string
  signal?: AbortSignal | null
  cache?: RequestCache
  credentials?: RequestCredentials
  mode?: RequestMode
  redirect?: RequestRedirect
  referrer?: string
  referrerPolicy?: ReferrerPolicy
  integrity?: string
  keepalive?: boolean
}

export const DEFAULT_API_BASE_URL = 'http://localhost:3001'

const tryResolveRuntimeConfigBaseUrl = (): string | undefined => {
  try {
    const runtimeConfig = useRuntimeConfig()
    const configuredApiBase = runtimeConfig.public.apiBase

    if (typeof configuredApiBase !== 'string') {
      return undefined
    }

    const normalizedApiBase = configuredApiBase.trim()
    return normalizedApiBase.length > 0 ? normalizedApiBase : undefined
  } catch {
    return undefined
  }
}

export const resolveApiBaseUrl = (baseURL?: string): string => {
  return (baseURL ?? tryResolveRuntimeConfigBaseUrl() ?? DEFAULT_API_BASE_URL).replace(/\/$/, '')
}

const buildUrl = (path: string, baseURL?: string): string => {
  if (/^https?:\/\//.test(path)) {
    return path
  }

  const normalizedPath = path.startsWith('/') ? path : `/${path}`
  return `${resolveApiBaseUrl(baseURL)}${normalizedPath}`
}

const normalizeBody = (body: ApiClientOptions['body']): BodyInit | undefined => {
  if (body === undefined) {
    return undefined
  }

  if (
    typeof body === 'string' ||
    body instanceof FormData ||
    body instanceof URLSearchParams ||
    body instanceof Blob ||
    body instanceof ArrayBuffer
  ) {
    return body
  }

  return JSON.stringify(body)
}

const buildHeaders = (
  headers: HeadersInit | undefined,
  body: ApiClientOptions['body']
): HeadersInit | undefined => {
  if (
    body === undefined ||
    typeof body === 'string' ||
    body instanceof FormData ||
    body instanceof URLSearchParams ||
    body instanceof Blob ||
    body instanceof ArrayBuffer
  ) {
    return headers
  }

  return {
    'Content-Type': 'application/json',
    ...(headers ?? {})
  }
}

export const unwrapApiSuccess = <T>(response: ApiEnvelope<T>): T => {
  if (!response.success) {
    throw new ApiClientError({
      message: response.error.message,
      code: response.error.code,
      requestId: response.error.request_id,
      details: response.error.details
    })
  }

  return response.data
}

export const requestApi = async <T>(path: string, options: ApiClientOptions = {}): Promise<ApiEnvelope<T>> => {
  const response = await fetch(buildUrl(path, options.baseURL), {
    method: options.method,
    headers: buildHeaders(options.headers, options.body),
    body: normalizeBody(options.body),
    signal: options.signal ?? undefined,
    cache: options.cache,
    credentials: options.credentials,
    mode: options.mode,
    redirect: options.redirect,
    referrer: options.referrer,
    referrerPolicy: options.referrerPolicy,
    integrity: options.integrity,
    keepalive: options.keepalive
  })

  const envelope = (await response.json()) as ApiEnvelope<T> | undefined

  if (!envelope) {
    throw new ApiClientError({
      message: 'API response body is empty',
      code: 'API_CLIENT_EMPTY_RESPONSE',
      status: response.status
    })
  }

  if (!response.ok && envelope.success) {
    throw new ApiClientError({
      message: `Unexpected successful envelope on HTTP ${response.status}`,
      code: 'API_CLIENT_HTTP_STATUS_MISMATCH',
      status: response.status,
      details: envelope
    })
  }

  return envelope
}

export const requestApiData = async <T>(path: string, options: ApiClientOptions = {}): Promise<T> => {
  try {
    const envelope = await requestApi<T>(path, options)
    return unwrapApiSuccess(envelope)
  } catch (error) {
    if (error instanceof ApiClientError) {
      throw error
    }

    throw new ApiClientError({
      message: error instanceof Error ? error.message : 'Unknown API client error',
      code: 'API_CLIENT_ERROR'
    })
  }
}

export type { ApiEnvelope, ApiFailure, ApiSuccess }
