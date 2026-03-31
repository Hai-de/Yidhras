import type { ApiEnvelope, ApiFailure, ApiSuccess } from '@yidhras/contracts'

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

export interface ApiClientOptions extends Omit<RequestInit, 'body'> {
  body?: BodyInit | Record<string, unknown>
  baseURL?: string
}

const DEFAULT_API_BASE_URL = 'http://localhost:3001'

const resolveBaseUrl = (baseURL?: string): string => {
  return (baseURL ?? DEFAULT_API_BASE_URL).replace(/\/$/, '')
}

const buildUrl = (path: string, baseURL?: string): string => {
  if (/^https?:\/\//.test(path)) {
    return path
  }

  const normalizedPath = path.startsWith('/') ? path : `/${path}`
  return `${resolveBaseUrl(baseURL)}${normalizedPath}`
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

const buildHeaders = (headers: HeadersInit | undefined, body: ApiClientOptions['body']): HeadersInit | undefined => {
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
  const response = await $fetch.raw<ApiEnvelope<T>>(buildUrl(path, options.baseURL), {
    ...options,
    body: normalizeBody(options.body),
    headers: buildHeaders(options.headers, options.body)
  })

  return response._data
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
