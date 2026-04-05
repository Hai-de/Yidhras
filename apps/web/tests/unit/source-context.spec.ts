import { describe, expect, it } from 'vitest'

import {
  buildSocialSemanticHint,
  buildSourceSummary,
  normalizeSourcePage,
  type OperatorSourceSnapshot
} from '../../features/shared/source-context'

const baseSource = (): OperatorSourceSnapshot => ({
  sourcePage: null,
  sourcePostId: null,
  sourceEventId: null,
  sourceRootId: null,
  sourceNodeId: null,
  sourceRunId: null,
  sourceDecisionId: null,
  sourceAgentId: null,
  sourcePartitionId: null,
  sourceWorkerId: null
})

describe('operator source-context helpers', () => {
  it('normalizes supported source pages', () => {
    expect(normalizeSourcePage('overview')).toBe('overview')
    expect(normalizeSourcePage('workflow')).toBe('workflow')
    expect(normalizeSourcePage('agent')).toBe('agent')
    expect(normalizeSourcePage('scheduler')).toBe('scheduler')
    expect(normalizeSourcePage('unknown')).toBeNull()
  })

  it('builds source summary for scheduler/operator sources', () => {
    expect(
      buildSourceSummary({
        ...baseSource(),
        sourcePage: 'overview',
        sourceRunId: 'run-42'
      })
    ).toBe('Opened from overview scheduler run run-42')

    expect(
      buildSourceSummary({
        ...baseSource(),
        sourcePage: 'agent',
        sourceAgentId: 'agent-7'
      })
    ).toBe('Opened from agent agent-7')

    expect(
      buildSourceSummary({
        ...baseSource(),
        sourcePage: 'scheduler',
        sourcePartitionId: 'p5'
      })
    ).toBe('Opened from scheduler partition p5')
  })

  it('builds timeline and social semantic hints without regressing mapping semantics', () => {
    expect(
      buildSocialSemanticHint(
        {
          ...baseSource(),
          sourcePage: 'timeline'
        },
        {
          sourceActionIntentId: 'intent-1',
          fromTick: '100',
          toTick: '100',
          keyword: null
        }
      )
    ).toBe('Timeline context uses source_action_intent_id intent-1 to narrow related social posts.')

    expect(
      buildSocialSemanticHint(
        {
          ...baseSource(),
          sourcePage: 'social'
        },
        {
          sourceActionIntentId: null,
          fromTick: '200',
          toTick: '200',
          keyword: null
        }
      )
    ).toBe('Social context opens a related timeline slice at tick range 200 → 200, not an exact event id mapping.')
  })
})
