import { describe, expect, it } from 'vitest'

import { evaluateProjectionRules } from '../../../src/domain/projection/projection_evaluator.js'
import type { ProjectionEvaluationContext, ProjectionRuleDef } from '../../../src/domain/projection/types.js'
import { expectDefined } from '../../helpers/assertions.js'

const buildEmptyContext = (overrides: Partial<ProjectionEvaluationContext> = {}): ProjectionEvaluationContext => ({
  packId: 'test-pack',
  currentTick: 10n,
  entities: [],
  entityStates: [],
  mediatorBindings: [],
  authorityGrants: [],
  ruleExecutionRecords: [],
  ...overrides
})

describe('evaluateProjectionRules', () => {
  it('returns empty array when no rules provided', () => {
    const results = evaluateProjectionRules([], buildEmptyContext())
    expect(results).toEqual([])
  })

  it('counts entities when compute is "count"', () => {
    const context = buildEmptyContext({
      entities: [
        { id: 'e1', entity_kind: 'actor', entity_type: 'player' },
        { id: 'e2', entity_kind: 'actor', entity_type: 'player' },
        { id: 'e3', entity_kind: 'actor', entity_type: 'player' }
      ]
    })

    const rules: ProjectionRuleDef[] = [
      {
        id: 'count-players',
        when: {},
        then: { compute: 'count', target_projection: 'player_count', source_entity_type: 'player' }
      }
    ]

    const results = evaluateProjectionRules(rules, context)
    expect(results).toHaveLength(1)
    expect(results[0].projection_key).toBe('player_count')
    expect(results[0].computed_value).toBe(3)
  })

  it('sums numeric state values when compute is "sum"', () => {
    const context = buildEmptyContext({
      entities: [
        { id: 'e1', entity_kind: 'actor', entity_type: 'player' },
        { id: 'e2', entity_kind: 'actor', entity_type: 'player' }
      ],
      entityStates: [
        { entity_id: 'e1', state_namespace: 'core', state_json: { score: 10 } },
        { entity_id: 'e2', state_namespace: 'core', state_json: { score: 25 } }
      ]
    })

    const rules: ProjectionRuleDef[] = [
      {
        id: 'total-score',
        when: {},
        then: { compute: 'sum', target_projection: 'total_score', source_entity_type: 'player', source_state_key: 'score' }
      }
    ]

    const results = evaluateProjectionRules(rules, context)
    expect(results).toHaveLength(1)
    expect(results[0].computed_value).toBe(35)
  })

  it('returns empty when no entities match source_entity_type', () => {
    const context = buildEmptyContext({
      entities: [
        { id: 'e1', entity_kind: 'actor', entity_type: 'npc' }
      ]
    })

    const rules: ProjectionRuleDef[] = [
      {
        id: 'no-players',
        when: {},
        then: { compute: 'sum', target_projection: 'total_score', source_entity_type: 'player', source_state_key: 'score' }
      }
    ]

    const results = evaluateProjectionRules(rules, context)
    expect(results).toHaveLength(0)
  })

  it('skips entities without the source_state_key', () => {
    const context = buildEmptyContext({
      entities: [
        { id: 'e1', entity_kind: 'actor', entity_type: 'player' },
        { id: 'e2', entity_kind: 'actor', entity_type: 'player' }
      ],
      entityStates: [
        { entity_id: 'e1', state_namespace: 'core', state_json: { score: 10 } }
        // e2 has no state record
      ]
    })

    const rules: ProjectionRuleDef[] = [
      {
        id: 'partial',
        when: {},
        then: { compute: 'sum', target_projection: 'total_score', source_entity_type: 'player', source_state_key: 'score' }
      }
    ]

    const results = evaluateProjectionRules(rules, context)
    expect(results[0].computed_value).toBe(10)
  })

  it('respects tick_interval -- fires when cumulative distance since last execution meets interval', () => {
    const lastExecutionTicks = new Map<string, bigint>()
    lastExecutionTicks.set('every-3-ticks', 2n)

    const context = buildEmptyContext({
      currentTick: 5n,
      entities: [{ id: 'e1', entity_kind: 'actor', entity_type: 'player' }],
      lastExecutionTicks
    })

    const rules: ProjectionRuleDef[] = [
      {
        id: 'every-3-ticks',
        when: { tick_interval: 3 },
        then: { compute: 'count', target_projection: 'periodic_count', source_entity_type: 'player' }
      }
    ]

    // tick 5, last execution at tick 2: 5 - 2 = 3 >= 3, fires
    const results1 = evaluateProjectionRules(rules, context)
    expect(results1).toHaveLength(1)

    // tick 5, last execution at tick 3: 5 - 3 = 2 < 3, skip
    const lastExec2 = new Map<string, bigint>()
    lastExec2.set('every-3-ticks', 3n)
    const results2 = evaluateProjectionRules(rules, { ...context, currentTick: 5n, lastExecutionTicks: lastExec2 })
    expect(results2).toHaveLength(0)
  })

  it('filters by entity_type_is in when clause', () => {
    const context = buildEmptyContext({
      entities: [
        { id: 'e1', entity_kind: 'actor', entity_type: 'player' },
        { id: 'e2', entity_kind: 'actor', entity_type: 'npc' }
      ]
    })

    const rules: ProjectionRuleDef[] = [
      {
        id: 'only-players',
        when: { entity_type_is: 'player' },
        then: { compute: 'count', target_projection: 'player_count' }
      }
    ]

    const results = evaluateProjectionRules(rules, context)
    expect(results).toHaveLength(1)
  })

  it('skips rules when entity_type_is filter finds no matches', () => {
    const context = buildEmptyContext({
      entities: [
        { id: 'e1', entity_kind: 'actor', entity_type: 'npc' }
      ]
    })

    const rules: ProjectionRuleDef[] = [
      {
        id: 'only-players',
        when: { entity_type_is: 'player' },
        then: { compute: 'count', target_projection: 'player_count' }
      }
    ]

    const results = evaluateProjectionRules(rules, context)
    expect(results).toHaveLength(0)
  })

  it('aggregates by dimensions with aggregate_by', () => {
    const context = buildEmptyContext({
      entities: [
        { id: 'e1', entity_kind: 'actor', entity_type: 'player' },
        { id: 'e2', entity_kind: 'actor', entity_type: 'player' },
        { id: 'e3', entity_kind: 'actor', entity_type: 'player' }
      ],
      entityStates: [
        { entity_id: 'e1', state_namespace: 'core', state_json: { score: 10, faction: 'red' } },
        { entity_id: 'e2', state_namespace: 'core', state_json: { score: 20, faction: 'blue' } },
        { entity_id: 'e3', state_namespace: 'core', state_json: { score: 30, faction: 'red' } }
      ]
    })

    const rules: ProjectionRuleDef[] = [
      {
        id: 'by-faction',
        when: {},
        then: {
          compute: 'sum',
          target_projection: 'faction_scores',
          source_entity_type: 'player',
          source_state_key: 'score',
          aggregate_by: ['faction']
        }
      }
    ]

    const results = evaluateProjectionRules(rules, context)
    expect(results).toHaveLength(2)

    const red = results.find(r => r.dimensions.faction === 'red')
    const blue = results.find(r => r.dimensions.faction === 'blue')
    expect(expectDefined(red, 'red faction projection').computed_value).toBe(40)
    expect(expectDefined(blue, 'blue faction projection').computed_value).toBe(20)
  })

  it('computes max correctly', () => {
    const context = buildEmptyContext({
      entities: [
        { id: 'e1', entity_kind: 'actor', entity_type: 'player' },
        { id: 'e2', entity_kind: 'actor', entity_type: 'player' }
      ],
      entityStates: [
        { entity_id: 'e1', state_namespace: 'core', state_json: { score: 10 } },
        { entity_id: 'e2', state_namespace: 'core', state_json: { score: 25 } }
      ]
    })

    const rules: ProjectionRuleDef[] = [
      {
        id: 'max-score',
        when: {},
        then: { compute: 'max', target_projection: 'top_score', source_entity_type: 'player', source_state_key: 'score' }
      }
    ]

    const results = evaluateProjectionRules(rules, context)
    expect(results[0].computed_value).toBe(25)
  })

  it('computes min correctly', () => {
    const context = buildEmptyContext({
      entities: [
        { id: 'e1', entity_kind: 'actor', entity_type: 'player' },
        { id: 'e2', entity_kind: 'actor', entity_type: 'player' }
      ],
      entityStates: [
        { entity_id: 'e1', state_namespace: 'core', state_json: { score: 10 } },
        { entity_id: 'e2', state_namespace: 'core', state_json: { score: 25 } }
      ]
    })

    const rules: ProjectionRuleDef[] = [
      {
        id: 'min-score',
        when: {},
        then: { compute: 'min', target_projection: 'lowest_score', source_entity_type: 'player', source_state_key: 'score' }
      }
    ]

    const results = evaluateProjectionRules(rules, context)
    expect(results[0].computed_value).toBe(10)
  })

  it('returns empty array when no entities have the source state', () => {
    const context = buildEmptyContext({
      entities: [
        { id: 'e1', entity_kind: 'actor', entity_type: 'player' }
      ],
      entityStates: []
    })

    const rules: ProjectionRuleDef[] = [
      {
        id: 'no-state',
        when: {},
        then: { compute: 'sum', target_projection: 'total', source_entity_type: 'player', source_state_key: 'missing_key' }
      }
    ]

    const results = evaluateProjectionRules(rules, context)
    expect(results).toHaveLength(0)
  })
})
