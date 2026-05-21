import type { InferenceContext, ProviderDecisionRaw } from '../../types.js';

export type BTStatus = 'success' | 'failure' | 'running';

export type BTCompositeType = 'selector' | 'sequence';

export type BTDecoratorType = 'inverter' | 'cooldown' | 'probability';

export type BTLeafType = 'condition' | 'action' | 'llm_decision';

export type BTConditionOperator = 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'in' | 'not_in';

export type BTConditionKey =
  | 'state'
  | 'has_artifact'
  | 'not_has_artifact'
  | 'event_semantic_type'
  | 'world_state'
  | 'ticks_since_event'
  | 'in'
  | 'not_in';

export interface BTConditionExpr {
  [key: string]: unknown;
}

export interface BTCompoundCondition {
  all?: BTConditionExpr[];
  any?: BTConditionExpr[];
}

export interface BTDecoratorDef {
  type: BTDecoratorType;
  cooldown_ticks?: number;
  weight?: number;
}

export interface BTActionDef {
  semantic_intent?: string;
  kernel?: string;
  proposed_method?: string;
  target_ref?: { entity_id: string; kind: string };
  reasoning?: string;
  desired_effect?: string;
  payload?: Record<string, unknown>;
}

export interface BTLLMDecisionDef {
  prompt_template: string;
  provider: string;
  model: string;
}

export interface BTNodeDef {
  type?: BTCompositeType | BTLeafType;
  children?: BTNodeDef[];
  decorators?: BTDecoratorDef[];
  child?: BTNodeDef;
  condition?: BTCompoundCondition | BTConditionExpr;
  action?: BTActionDef;
  prompt_template?: string;
  provider?: string;
  model?: string;
  $ref?: string;
  /** Internal runtime path assigned after $ref expansion; not accepted from YAML schema. */
  __node_path?: string;
}

export interface BTEvalContext {
  inferenceContext: InferenceContext;
  blackboard: Record<string, unknown>;
}

export interface BTNodeTrace {
  nodePath: string;
  nodeType: string;
  status: BTStatus | 'skipped';
  durationMs: number;
  discardedDecision?: ProviderDecisionRaw | null;
}

export interface BTDecisionTrace {
  agentId: string;
  treeName: string;
  simTick: bigint;
  nodeTraces: BTNodeTrace[];
  finalDecision: ProviderDecisionRaw | null;
}

export interface BTCooldownState {
  lastSuccessTick: bigint;
}

export interface BTTreeDefinition {
  name: string;
  root: BTNodeDef;
  sourcePackId: string;
}
