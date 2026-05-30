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
  all?: BTConditionExpr[] | undefined;
  any?: BTConditionExpr[] | undefined;
}

export interface BTDecoratorDef {
  type: BTDecoratorType;
  cooldown_ticks?: number | undefined;
  weight?: number | undefined;
}

export interface BTActionDef {
  semantic_intent?: string | undefined;
  kernel?: string | undefined;
  proposed_method?: string | undefined;
  target_ref?: { entity_id: string; kind: string };
  reasoning?: string | undefined;
  desired_effect?: string | undefined;
  payload?: Record<string, unknown> | undefined;
  call_handler?: string | undefined;
}

export interface BTLLMDecisionDef {
  prompt_template: string;
  provider: string;
  model: string;
}

export interface BTNodeDef {
  type?: BTCompositeType | BTLeafType | undefined;
  children?: BTNodeDef[] | undefined;
  decorators?: BTDecoratorDef[] | undefined;
  child?: BTNodeDef | undefined;
  condition?: BTCompoundCondition | BTConditionExpr | undefined;
  action?: BTActionDef | undefined;
  prompt_template?: string | undefined;
  provider?: string | undefined;
  model?: string | undefined;
  $ref?: string | undefined;
  /** Internal runtime path assigned after $ref expansion; not accepted from YAML schema. */
  __node_path?: string | undefined;
}

export interface BTEvalContext {
  inferenceContext: InferenceContext;
  blackboard: Record<string, unknown>;
  aiTaskService?: import('../../../ai/task_service.js').AiTaskService;
  callHandler?: (name: string, input: unknown) => Promise<unknown>;
}

export interface BTNodeTrace {
  nodePath: string;
  nodeType: string;
  status: BTStatus | 'skipped';
  durationMs: number;
  discardedDecision?: ProviderDecisionRaw | null | undefined;
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
