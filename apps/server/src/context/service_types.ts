import type { IdentityContext } from '../identity/types.js';
import type {
  InferencePackStateSnapshot,
  InferencePolicySummary
} from '../inference/types.js';
import type { MemoryContextPack } from '../memory/types.js';
import type { PerceptionRuleDef } from '../perception/types.js';
import type { ContextRun, ContextSelectionResult } from './types.js';

export interface BuildContextRunInput {
  actor_ref: Record<string, unknown>;
  identity?: IdentityContext | null;
  resolved_agent_id: string | null;
  tick: bigint;
  policy_summary?: InferencePolicySummary | null;
  pack_state?: InferencePackStateSnapshot | null;
  pack_id?: string | null;
  agent_capabilities?: string[];
  perception_rules?: PerceptionRuleDef[];
}

export interface ContextServiceBuildResult {
  context_run: ContextRun;
  selection: ContextSelectionResult;
  memory_context: MemoryContextPack;
}

export interface ContextService {
  buildContextRun(input: BuildContextRunInput): Promise<ContextServiceBuildResult>;
}
