import { evaluateCondition } from '../context_resolver.js';
import type { BTActionDef, BTLLMDecisionDef, BTNodeDef, BTEvalContext, BTStatus } from '../types.js';

export function tickCondition(
  condition: BTNodeDef['condition'],
  ctx: BTEvalContext
): BTStatus {
  if (!condition) return 'failure';
  return evaluateCondition(condition, ctx) ? 'success' : 'failure';
}

export function tickAction(
  action: BTActionDef,
  ctx: BTEvalContext
): BTStatus {
  ctx.blackboard['__last_decision'] = buildDecisionResult(action);
  return 'success';
}

export async function tickLLMDecision(
  _llm: BTLLMDecisionDef,
  _ctx: BTEvalContext
): Promise<BTStatus> {
  // Stub: Phase 6 wires AI Gateway
  return 'failure';
}

function buildDecisionResult(action: BTActionDef): Record<string, unknown> {
  return {
    action_type: action.semantic_intent ?? action.kernel ?? 'unknown',
    target_ref: action.target_ref ?? null,
    payload: action.payload ?? {},
    reasoning: action.reasoning ?? undefined,
    confidence: undefined,
    delay_hint_ticks: undefined,
    meta: undefined
  };
}
