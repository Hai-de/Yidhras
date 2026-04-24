import type { AppContext } from '../app/context.js';
import type { IdentityContext, IdentityType } from '../identity/types.js';
import type {
  InferenceActorRef,
  InferencePackStateSnapshot,
  InferencePolicySummary} from '../inference/types.js';
import type { LongMemoryBlockStore } from '../memory/blocks/types.js';
import type { MemorySelectionResult } from '../memory/types.js';
import type { ContextOverlayStore } from './overlay/types.js';
import { buildContextNodesFromMemoryBlocks } from './sources/memory_blocks.js';
import { buildContextNodesFromMemorySelection } from './sources/memory_selection.js';
import { buildContextNodesFromOverlayEntries } from './sources/overlay.js';
import { buildRuntimeStateContextNodes } from './sources/runtime_state.js';
import type { ContextNode } from './types.js';

export interface ContextSourceAdapterInput {
  tick: bigint;
  actor_ref: Record<string, unknown> | null;
  identity?: IdentityContext | null;
  resolved_agent_id: string | null;
  memory_selection: MemorySelectionResult;
  policy_summary?: InferencePolicySummary | null;
  pack_state?: InferencePackStateSnapshot | null;
  pack_id?: string | null;
}

export interface ContextSourceAdapterBuildResult {
  nodes: ContextNode[];
  diagnostics?: Record<string, unknown> | null;
}

export interface ContextSourceAdapter {
  name: string;
  buildNodes(input: ContextSourceAdapterInput): Promise<ContextNode[] | ContextSourceAdapterBuildResult> | ContextNode[] | ContextSourceAdapterBuildResult;
}

export interface CreateContextSourceAdaptersOptions {
  context?: AppContext;
  overlayStore?: ContextOverlayStore | null;
  longMemoryBlockStore?: LongMemoryBlockStore | null;
}

const toInferenceActorRef = (actorRef: Record<string, unknown> | null, resolvedAgentId: string | null): InferenceActorRef | null => {
  if (!actorRef) {
    return null;
  }

  const identityId = typeof actorRef.identity_id === 'string' ? actorRef.identity_id : null;
  const identityType = typeof actorRef.identity_type === 'string' ? actorRef.identity_type : null;
  const role = actorRef.role === 'atmosphere' ? 'atmosphere' : actorRef.role === 'active' ? 'active' : null;
  if (!identityId || !identityType || !role) {
    return null;
  }

  return {
    identity_id: identityId,
    identity_type: identityType as IdentityType,
    role,
    agent_id: typeof actorRef.agent_id === 'string' ? actorRef.agent_id : resolvedAgentId,
    atmosphere_node_id: typeof actorRef.atmosphere_node_id === 'string' ? actorRef.atmosphere_node_id : null
  };
};

const createMemorySelectionSourceAdapter = (): ContextSourceAdapter => ({
  name: 'memory-selection',
  buildNodes(input) {
    return buildContextNodesFromMemorySelection(input.memory_selection);
  }
});

const createRuntimeStateSourceAdapter = (): ContextSourceAdapter => ({
  name: 'runtime-state-snapshots',
  buildNodes(input) {
    return buildRuntimeStateContextNodes({
      tick: input.tick.toString(),
      resolved_agent_id: input.resolved_agent_id,
      policy_summary: input.policy_summary ?? null,
      pack_state: input.pack_state ?? null
    });
  }
});

const createOverlaySourceAdapter = (overlayStore: ContextOverlayStore): ContextSourceAdapter => ({
  name: 'context-overlay-store',
  async buildNodes(input) {
    if (!input.resolved_agent_id) {
      return [];
    }

    const entries = await overlayStore.listEntries({
      actor_id: input.resolved_agent_id,
      pack_id: input.pack_id ?? null,
      statuses: ['active'],
      limit: 20
    });

    return buildContextNodesFromOverlayEntries(entries);
  }
});

const createMemoryBlockSourceAdapter = (
  context: AppContext,
  longMemoryBlockStore: LongMemoryBlockStore
): ContextSourceAdapter => ({
  name: 'memory-block-runtime',
  async buildNodes(input) {
    const actorRef = toInferenceActorRef(input.actor_ref, input.resolved_agent_id);
    if (!actorRef || !input.identity || !input.resolved_agent_id || !input.pack_state || !input.pack_id) {
      return {
        nodes: [],
        diagnostics: {
          memory_blocks: {
            evaluated: [],
            inserted: [],
            delayed: [],
            cooling: [],
            retained: [],
            inactive: []
          }
        }
      };
    }

    const result = await buildContextNodesFromMemoryBlocks({
      context,
      actor_ref: actorRef,
      identity: input.identity,
      resolved_agent_id: input.resolved_agent_id,
      pack_id: input.pack_id,
      tick: input.tick,
      attributes: {},
      pack_state: input.pack_state,
      longMemoryBlockStore
    });

    return {
      nodes: result.nodes,
      diagnostics: {
        engine_owner: result.evaluation_metadata?.provider?.startsWith('rust') ? 'rust_sidecar' : 'ts_host',
        engine_mode: result.evaluation_metadata?.provider ?? 'rust_primary',
        trigger_rate: result.trigger_rate_summary ?? {
          present_count: 0,
          applied_count: 0,
          blocked_count: 0
        },
        memory_blocks: {
          evaluated: result.evaluations,
          inserted: result.evaluations.filter(item => item.status === 'active').map(item => item.memory_id),
          delayed: result.evaluations.filter(item => item.status === 'delayed').map(item => item.memory_id),
          cooling: result.evaluations.filter(item => item.status === 'cooling').map(item => item.memory_id),
          retained: result.evaluations.filter(item => item.status === 'retained').map(item => item.memory_id),
          inactive: result.evaluations.filter(item => item.status === 'inactive').map(item => item.memory_id)
        }
      }
    };
  }
});

export const createDefaultContextSourceAdapters = (options: CreateContextSourceAdaptersOptions = {}): ContextSourceAdapter[] => {
  return [
    createMemorySelectionSourceAdapter(),
    createRuntimeStateSourceAdapter(),
    ...(options.longMemoryBlockStore && options.context ? [createMemoryBlockSourceAdapter(options.context, options.longMemoryBlockStore)] : []),
    ...(options.overlayStore ? [createOverlaySourceAdapter(options.overlayStore)] : [])
  ];
};

export const buildContextNodesFromSources = (
  adapters: ContextSourceAdapter[],
  input: ContextSourceAdapterInput
): Promise<{ nodes: ContextNode[]; adapter_names: string[]; diagnostics: Record<string, unknown> }> => {
  return (async () => {
    const nodes: ContextNode[] = [];
    const adapterNames: string[] = [];
    const diagnostics: Record<string, unknown> = {};

    for (const adapter of adapters) {
      adapterNames.push(adapter.name);
      const built = await adapter.buildNodes(input);
      if (Array.isArray(built)) {
        nodes.push(...built);
        continue;
      }

      nodes.push(...built.nodes);
      if (built.diagnostics && typeof built.diagnostics === 'object') {
        diagnostics[adapter.name] = built.diagnostics;
      }
    }

    return {
      nodes,
      adapter_names: adapterNames,
      diagnostics
    };
  })();
};
