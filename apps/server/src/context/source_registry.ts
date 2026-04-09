import type {
  InferencePackStateSnapshot,
  InferencePolicySummary
} from '../inference/types.js';
import type { MemorySelectionResult } from '../memory/types.js';
import type { ContextOverlayStore } from './overlay/types.js';
import { buildContextNodesFromMemorySelection } from './sources/legacy_memory.js';
import { buildContextNodesFromOverlayEntries } from './sources/overlay.js';
import { buildRuntimeStateContextNodes } from './sources/runtime_state.js';
import type { ContextNode } from './types.js';

export interface ContextSourceAdapterInput {
  tick: bigint;
  actor_ref: Record<string, unknown> | null;
  resolved_agent_id: string | null;
  memory_selection: MemorySelectionResult;
  policy_summary?: InferencePolicySummary | null;
  pack_state?: InferencePackStateSnapshot | null;
  pack_id?: string | null;
}

export interface ContextSourceAdapter {
  name: string;
  buildNodes(input: ContextSourceAdapterInput): Promise<ContextNode[]> | ContextNode[];
}

export interface CreateContextSourceAdaptersOptions {
  overlayStore?: ContextOverlayStore | null;
}

const createLegacyMemorySourceAdapter = (): ContextSourceAdapter => ({
  name: 'legacy-memory-selection',
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

export const createDefaultContextSourceAdapters = (options: CreateContextSourceAdaptersOptions = {}): ContextSourceAdapter[] => {
  return [
    createLegacyMemorySourceAdapter(),
    createRuntimeStateSourceAdapter(),
    ...(options.overlayStore ? [createOverlaySourceAdapter(options.overlayStore)] : [])
  ];
};

export const buildContextNodesFromSources = (
  adapters: ContextSourceAdapter[],
  input: ContextSourceAdapterInput
): Promise<{ nodes: ContextNode[]; adapter_names: string[] }> => {
  return (async () => {
    const nodes: ContextNode[] = [];
    const adapterNames: string[] = [];

    for (const adapter of adapters) {
      adapterNames.push(adapter.name);
      nodes.push(...(await adapter.buildNodes(input)));
    }

    return {
      nodes,
      adapter_names: adapterNames
    };
  })();
};
