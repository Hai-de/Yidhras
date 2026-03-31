import type { SocialPostSnapshot } from '../../composables/api/useSocialApi'

export interface SocialPostCardViewModel {
  id: string
  title: string
  body: string
  meta: string
  signalLabel: string
  authorId: string
  sourceActionIntentId: string | null
}

const toSignalStrength = (noiseLevel: number): string => {
  const signalStrength = 1 - noiseLevel

  if (signalStrength >= 0.75) {
    return 'high'
  }

  if (signalStrength >= 0.45) {
    return 'medium'
  }

  return 'low'
}

export const toSocialPostCardViewModel = (post: SocialPostSnapshot): SocialPostCardViewModel => {
  return {
    id: post.id,
    title: `Post ${post.id.slice(0, 8)}`,
    body: post.content,
    meta: `author ${post.author_id} · tick ${post.created_at}`,
    signalLabel: toSignalStrength(post.noise_level),
    authorId: post.author_id,
    sourceActionIntentId: post.source_action_intent_id
  }
}
