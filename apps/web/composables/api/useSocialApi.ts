import type { ApiSuccessMeta } from '@yidhras/contracts'

import { requestApi } from '../../lib/http/client'
import { normalizeOptionalString } from '../../lib/route/query'
import type { TickString } from '../../lib/time/tick'

export interface SocialPostSnapshot {
  id: string
  author_id: string
  source_action_intent_id: string | null
  content: string
  noise_level: number
  is_encrypted: boolean
  created_at: TickString
}

export interface SocialFeedQueryInput {
  limit?: number
  authorId?: string | null
  agentId?: string | null
  circleId?: string | null
  keyword?: string | null
  sort?: 'latest' | 'signal'
  sourceActionIntentId?: string | null
  fromTick?: TickString | null
  toTick?: TickString | null
  signalMin?: number | null
  signalMax?: number | null
  cursor?: string | null
}

export interface SocialFeedSnapshot {
  items: SocialPostSnapshot[]
  pagination: NonNullable<ApiSuccessMeta['pagination']>
}

const buildSocialFeedQueryString = (input: SocialFeedQueryInput): string => {
  const searchParams = new URLSearchParams()

  if (typeof input.limit === 'number' && Number.isFinite(input.limit)) {
    searchParams.set('limit', String(Math.max(1, Math.trunc(input.limit))))
  }

  const authorId = normalizeOptionalString(input.authorId)
  const agentId = normalizeOptionalString(input.agentId)
  const circleId = normalizeOptionalString(input.circleId)
  const keyword = normalizeOptionalString(input.keyword)
  const sourceActionIntentId = normalizeOptionalString(input.sourceActionIntentId)
  const fromTick = normalizeOptionalString(input.fromTick)
  const toTick = normalizeOptionalString(input.toTick)
  const cursor = normalizeOptionalString(input.cursor)

  if (authorId) searchParams.set('author_id', authorId)
  if (agentId) searchParams.set('agent_id', agentId)
  if (circleId) searchParams.set('circle_id', circleId)
  if (keyword) searchParams.set('keyword', keyword)
  if (sourceActionIntentId) searchParams.set('source_action_intent_id', sourceActionIntentId)
  if (fromTick) searchParams.set('from_tick', fromTick)
  if (toTick) searchParams.set('to_tick', toTick)
  if (cursor) searchParams.set('cursor', cursor)
  if (input.sort && input.sort !== 'latest') searchParams.set('sort', input.sort)
  if (typeof input.signalMin === 'number' && Number.isFinite(input.signalMin)) {
    searchParams.set('signal_min', String(input.signalMin))
  }
  if (typeof input.signalMax === 'number' && Number.isFinite(input.signalMax)) {
    searchParams.set('signal_max', String(input.signalMax))
  }

  const queryString = searchParams.toString()
  return queryString.length > 0 ? `?${queryString}` : ''
}

export const useSocialApi = () => {
  return {
    listFeed: async (input: SocialFeedQueryInput = {}): Promise<SocialFeedSnapshot> => {
      const envelope = await requestApi<SocialPostSnapshot[]>(`/api/social/feed${buildSocialFeedQueryString(input)}`)

      if (!envelope.success) {
        throw new Error(envelope.error.message)
      }

      return {
        items: envelope.data,
        pagination: envelope.meta?.pagination ?? {
          has_next_page: false,
          next_cursor: null
        }
      }
    }
  }
}
