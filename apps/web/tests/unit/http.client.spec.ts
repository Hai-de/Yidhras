import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('#imports', () => ({
  useRuntimeConfig: () => ({
    public: {}
  })
}))

import {
  ApiClientError,
  requestApiData
} from '../../lib/http/client'

describe('http client', () => {
  const fetchMock = vi.fn()

  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.resetAllMocks()
  })

  it('returns data for successful envelopes', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue({
        success: true,
        data: {
          acknowledged: true
        }
      })
    })

    await expect(requestApiData('/api/test')).resolves.toEqual({
      acknowledged: true
    })
  })

  it('throws ApiClientError for failure envelopes', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 400,
      json: vi.fn().mockResolvedValue({
        success: false,
        error: {
          code: 'BAD_REQUEST',
          message: 'bad request',
          request_id: 'req-1',
          details: {
            field: 'status'
          }
        }
      })
    })

    await expect(requestApiData('/api/test')).rejects.toMatchObject({
      code: 'BAD_REQUEST',
      message: 'bad request',
      requestId: 'req-1',
      details: {
        field: 'status'
      }
    })
  })

  it('rejects empty response bodies', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue(undefined)
    })

    await expect(requestApiData('/api/test')).rejects.toMatchObject({
      code: 'API_CLIENT_EMPTY_RESPONSE',
      status: 200
    })
  })

  it('rejects http status and envelope mismatches', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 500,
      json: vi.fn().mockResolvedValue({
        success: true,
        data: {
          acknowledged: true
        }
      })
    })

    await expect(requestApiData('/api/test')).rejects.toMatchObject({
      code: 'API_CLIENT_HTTP_STATUS_MISMATCH',
      status: 500
    })
  })

  it('wraps unknown fetch errors into ApiClientError', async () => {
    fetchMock.mockRejectedValue(new Error('network down'))

    await expect(requestApiData('/api/test')).rejects.toMatchObject({
      code: 'API_CLIENT_ERROR',
      message: 'network down'
    })
  })

  it('preserves ApiClientError instances when already normalized', async () => {
    fetchMock.mockRejectedValue(
      new ApiClientError({
        message: 'already normalized',
        code: 'API_CLIENT_NORMALIZED'
      })
    )

    await expect(requestApiData('/api/test')).rejects.toMatchObject({
      code: 'API_CLIENT_NORMALIZED',
      message: 'already normalized'
    })
  })
})
