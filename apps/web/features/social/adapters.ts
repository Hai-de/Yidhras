import type { SocialPostSnapshot } from '../../composables/api/useSocialApi'

export interface SocialPostCardViewModel {
  id: string
  title: string
  body: string
  meta: string
  signalLabel: 'high' | 'medium' | 'low'
  signalScore: string
  authorId: string
  sourceActionIntentId: string | null
  createdAt: string
  timelineHint: string
}

const toSignalStrength = (noiseLevel: number): 'high' | 'medium' | 'low' => {
  const signalStrength = 1 - noiseLevel

  if (signalStrength >= 0.75) {
    return 'high'
  }

  if (signalStrength >= 0.45) {
    return 'medium'
  }

  return 'low'
}

const toSignalScore = (noiseLevel: number): string => {
  return `${Math.round((1 - noiseLevel) * 100)}%`
}

export const toSocialPostCardViewModel = (post: SocialPostSnapshot): SocialPostCardViewModel => {
  return {
    id: post.id,
    title: `Post ${post.id.slice(0, 8)}`,
    body: post.content,
    meta: `author ${post.author_id} · tick ${post.created_at}`,
    signalLabel: toSignalStrength(post.noise_level),
    signalScore: toSignalScore(post.noise_level),
    authorId: post.author_id,
    sourceActionIntentId: post.source_action_intent_id,
    createdAt: post.created_at,
    timelineHint: `tick ${post.created_at}`
  }
}
