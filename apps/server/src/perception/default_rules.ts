import type { PerceptionRuleDef } from './types.js';

/**
 * Built-in default perception rules.
 *
 * Used when pack declares no `rules.perception` (or empty array).
 * Rules are evaluated in array order — first match wins.
 * Unmatched inputs fall back to the engine-level fallback (global events → full, others → none).
 */
export const BUILTIN_PERCEPTION_RULES: PerceptionRuleDef[] = [
  // ── Event perception ──

  {
    id: 'builtin:event-same-location-public',
    when: { observer_at: 'same', event_visibility: 'public' },
    then: { level: 'full' }
  },
  {
    id: 'builtin:event-same-location-private-actor',
    when: { observer_at: 'same', event_visibility: 'private', observer_is_actor: true },
    then: { level: 'full' }
  },
  {
    id: 'builtin:event-same-location-private-other',
    when: { observer_at: 'same', event_visibility: 'private', observer_is_actor: false },
    then: { level: 'none' }
  },

  // ── Environment perception (higher count first — first match wins) ──

  {
    id: 'builtin:environment-investigated',
    when: { observer_at: 'same', investigation_count_min: 1 },
    then: { level: 'full', reveal_public: true, reveal_hidden: true }
  },
  {
    id: 'builtin:environment-no-investigation',
    when: { observer_at: 'same', investigation_count_min: 0 },
    then: { level: 'partial', reveal_public: true }
  }
];
