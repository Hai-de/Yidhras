import type {
  BTCompoundCondition,
  BTConditionExpr,
  BTConditionKey,
  BTConditionOperator,
  BTEvalContext
} from './types.js';

const OPERATORS: BTConditionOperator[] = ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'in', 'not_in'];

export const resolveContextValue = (
  key: BTConditionKey,
  value: string,
  ctx: BTEvalContext
): unknown => {
  const ps = ctx.inferenceContext.pack_state;

  switch (key) {
    case 'state':
      // eslint-disable-next-line security/detect-object-injection -- 行为树条件 key 来自受限 DSL，访问 actor_state 的动态字段是正式能力
      return ps.actor_state?.[value];

    case 'has_artifact':
      return ps.owned_artifacts.some((a) => a.id === value);

    case 'not_has_artifact':
      return !ps.owned_artifacts.some((a) => a.id === value);

    case 'event_semantic_type':
      return ps.recent_events.some((e) => e.semantic_type === value);

    case 'world_state':
      // eslint-disable-next-line security/detect-object-injection -- 行为树条件 key 来自受限 DSL，访问 world_state 的动态字段是正式能力
      return ps.world_state?.[value];

    case 'ticks_since_event': {
      const currentTick = ctx.inferenceContext.tick;
      const matched = ps.recent_events.find((e) => e.semantic_type === value);
      if (!matched || matched.tick === null) return null;
      return currentTick - BigInt(matched.tick);
    }

    case 'in':
      return ps.actor_roles.includes(value);

    case 'not_in':
      return !ps.actor_roles.includes(value);
  }
};

const applyOperator = (
  resolved: unknown,
  operator: BTConditionOperator,
  expected: unknown
): boolean => {
  switch (operator) {
    case 'eq':
      return resolved === expected;
    case 'neq':
      return resolved !== expected;
    case 'gt':
      return typeof resolved === 'bigint'
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- BigInt accepts string|number|bigint
        ? resolved > BigInt(expected as string | number | bigint)
        : typeof resolved === 'number' && typeof expected === 'number' && resolved > expected;
    case 'gte':
      return typeof resolved === 'bigint'
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- BigInt accepts string|number|bigint
        ? resolved >= BigInt(expected as string | number | bigint)
        : typeof resolved === 'number' && typeof expected === 'number' && resolved >= expected;
    case 'lt':
      return typeof resolved === 'bigint'
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- BigInt accepts string|number|bigint
        ? resolved < BigInt(expected as string | number | bigint)
        : typeof resolved === 'number' && typeof expected === 'number' && resolved < expected;
    case 'lte':
      return typeof resolved === 'bigint'
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- BigInt accepts string|number|bigint
        ? resolved <= BigInt(expected as string | number | bigint)
        : typeof resolved === 'number' && typeof expected === 'number' && resolved <= expected;
    case 'in':
      return resolved === true;
    case 'not_in':
      return resolved === true;
  }
};

const evaluateSimpleCondition = (
  cond: BTConditionExpr,
  ctx: BTEvalContext
): boolean => {
  const keys = Object.keys(cond);

  // The condition key is the first key that is not an operator
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- boundary type assertion
  const conditionKey = keys.find((k) => !OPERATORS.includes(k as BTConditionOperator));
  if (!conditionKey) return false;

   
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion, security/detect-object-injection -- blackboard condition value from DSL
  const conditionValue = cond[conditionKey] as string;
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- boundary type assertion
  const resolved = resolveContextValue(conditionKey as BTConditionKey, conditionValue, ctx);

  if (resolved === undefined || resolved === null) return false;

  // Find explicit operator; if none, implicit check (truthy/falsy)
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- boundary type assertion
  const operator = keys.find((k) => OPERATORS.includes(k as BTConditionOperator)) as
    | BTConditionOperator
    | undefined;

  if (!operator) {
    if (typeof resolved === 'boolean') return resolved;
    return Boolean(resolved);
  }

  // eslint-disable-next-line security/detect-object-injection -- operator 来自受限 DSL AST，动态读取比较值是正式能力
  return applyOperator(resolved, operator, cond[operator]);
};

const isCompoundCondition = (
  cond: BTConditionExpr | BTCompoundCondition
): cond is BTCompoundCondition => {
  return 'all' in cond || 'any' in cond;
};

const evaluateCompoundCondition = (
  cond: BTCompoundCondition,
  ctx: BTEvalContext
): boolean => {
  if (cond.all) {
    return cond.all.every((c) => evaluateCondition(c, ctx));
  }
  if (cond.any) {
    return cond.any.some((c) => evaluateCondition(c, ctx));
  }
  return false;
};

export const evaluateCondition = (
  condition: BTConditionExpr | BTCompoundCondition,
  ctx: BTEvalContext
): boolean => {
  if (isCompoundCondition(condition)) {
    return evaluateCompoundCondition(condition, ctx);
  }
  return evaluateSimpleCondition(condition, ctx);
};
