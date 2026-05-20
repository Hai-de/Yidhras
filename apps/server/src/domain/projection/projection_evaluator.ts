import type {
  ProjectionEvaluationContext,
  ProjectionEvaluationResult,
  ProjectionRuleDef
} from './types.js'

const matchesWhen = (
  rule: ProjectionRuleDef,
  context: ProjectionEvaluationContext
): boolean => {
  const { when } = rule

  if (when.tick_interval && when.tick_interval > 0) {
    const tickNum = Number(context.currentTick)
    if (tickNum % when.tick_interval !== 0) {
      return false
    }
  }

  if (when.entity_type_is) {
    const matchingEntities = context.entities.filter(
      e => e.entity_type === when.entity_type_is
    )
    if (matchingEntities.length === 0) {
      return false
    }
  }

  if (when.on_event_type) {
    const matchingRecords = context.ruleExecutionRecords.filter(
      r => r.execution_status === 'completed'
    )
    if (matchingRecords.length === 0) {
      return false
    }
  }

  return true
}

const getMatchingEntities = (
  rule: ProjectionRuleDef,
  context: ProjectionEvaluationContext
): Array<{ id: string; entity_kind: string; entity_type: string | null }> => {
  if (rule.then.source_entity_type) {
    return context.entities.filter(e => e.entity_type === rule.then.source_entity_type)
  }
  return context.entities
}

const getEntityStateValue = (
  entityId: string,
  stateKey: string,
  context: ProjectionEvaluationContext
): number | null => {
  const state = context.entityStates.find(
    s => s.entity_id === entityId && s.state_namespace === 'core'
  )
  if (!state) return null

  const value = state.state_json[stateKey]
  if (typeof value === 'number') return value
  if (typeof value === 'string') {
    const parsed = Number(value)
    return Number.isNaN(parsed) ? null : parsed
  }
  return null
}

const computeAggregation = (
  compute: ProjectionRuleDef['then']['compute'],
  values: number[]
): number => {
  if (values.length === 0) return 0

  switch (compute) {
    case 'count':
      return values.length
    case 'sum':
      return values.reduce((a, b) => a + b, 0)
    case 'max':
      return Math.max(...values)
    case 'min':
      return Math.min(...values)
    case 'collect':
      return values.length
  }
}

const evaluateSingleRule = (
  rule: ProjectionRuleDef,
  context: ProjectionEvaluationContext
): ProjectionEvaluationResult[] => {
  if (!matchesWhen(rule, context)) {
    return []
  }

  const { then } = rule
  const entities = getMatchingEntities(rule, context)

  if (then.aggregate_by && then.aggregate_by.length > 0) {
    const groups = new Map<string, { values: number[]; dimensions: Record<string, string> }>()

    for (const entity of entities) {
      const state = context.entityStates.find(
        s => s.entity_id === entity.id && s.state_namespace === 'core'
      )
      if (!state) continue

      const dimensionEntries: Array<[string, string]> = []
      for (const dim of then.aggregate_by) {
        const dimValue = state.state_json[dim]
        let dimStr = ''
        if (typeof dimValue === 'string') {
          dimStr = dimValue
        } else if (typeof dimValue === 'number' || typeof dimValue === 'boolean') {
          dimStr = String(dimValue)
        }
        dimensionEntries.push([dim, dimStr])
      }

      const groupKey = dimensionEntries.map(([, v]) => v).join(':')
      let group = groups.get(groupKey)
      if (!group) {
        group = { values: [], dimensions: Object.fromEntries(dimensionEntries) }
        groups.set(groupKey, group)
      }

      if (then.source_state_key) {
        const value = getEntityStateValue(entity.id, then.source_state_key, context)
        if (value !== null) {
          group.values.push(value)
        }
      } else {
        group.values.push(1)
      }
    }

    return Array.from(groups.entries()).map(([_key, group]) => ({
      projection_key: then.target_projection,
      computed_value: computeAggregation(then.compute, group.values),
      dimensions: group.dimensions
    }))
  }

  const values: number[] = []
  for (const entity of entities) {
    if (then.source_state_key) {
      const value = getEntityStateValue(entity.id, then.source_state_key, context)
      if (value !== null) {
        values.push(value)
      }
    } else {
      values.push(1)
    }
  }

  if (values.length === 0) {
    return []
  }

  return [
    {
      projection_key: then.target_projection,
      computed_value: computeAggregation(then.compute, values),
      dimensions: {}
    }
  ]
}

export const evaluateProjectionRules = (
  rules: ProjectionRuleDef[],
  context: ProjectionEvaluationContext
): ProjectionEvaluationResult[] => {
  const results: ProjectionEvaluationResult[] = []

  for (const rule of rules) {
    const ruleResults = evaluateSingleRule(rule, context)
    results.push(...ruleResults)
  }

  return results
}
