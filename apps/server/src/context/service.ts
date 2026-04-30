import { randomUUID } from 'node:crypto';

import type { AppInfrastructure } from '../app/context.js';
import type { IdentityContext } from '../identity/types.js';
import type {
  InferencePackStateSnapshot,
  InferencePolicySummary
} from '../inference/types.js';
import { createPrismaLongMemoryBlockStore } from '../memory/blocks/store.js';
import type { LongMemoryBlockStore } from '../memory/blocks/types.js';
import { createMemoryService, type MemoryService } from '../memory/service.js';
import type { MemoryContextPack, MemoryEntry, MemorySourceKind } from '../memory/types.js';
import { pluginRuntimeRegistry } from '../plugins/runtime.js';
import { createContextOverlayStore } from './overlay/store.js';
import type { ContextOverlayStore } from './overlay/types.js';
import { applyPolicyDecisionsToSelection, evaluateContextPolicies } from './policy_engine.js';
import { buildContextNodesFromSources, createDefaultContextSourceAdapters } from './source_registry.js';
import type { ContextMemoryBlockDiagnostics, ContextOverlayLoadedNode, ContextRun, ContextSelectionResult } from './types.js';

export interface BuildContextRunInput {
  actor_ref: Record<string, unknown>;
  identity?: IdentityContext | null;
  resolved_agent_id: string | null;
  tick: bigint;
  policy_summary?: InferencePolicySummary | null;
  pack_state?: InferencePackStateSnapshot | null;
  pack_id?: string | null;
}

export interface ContextServiceBuildResult {
  context_run: ContextRun;
  selection: ContextSelectionResult;
  memory_context: MemoryContextPack;
}

export interface ContextService {
  buildContextRun(input: BuildContextRunInput): Promise<ContextServiceBuildResult>;
}

export interface CreateContextServiceOptions {
  context: AppInfrastructure;
  memoryService?: MemoryService;
  overlayStore?: ContextOverlayStore | null;
  longMemoryBlockStore?: LongMemoryBlockStore | null;
}

const buildNodeCountsByType = (nodeTypes: string[]): Record<string, number> => {
  return nodeTypes.reduce<Record<string, number>>((acc, nodeType) => {
// eslint-disable-next-line security/detect-object-injection -- 从内部枚举构造的键
// eslint-disable-next-line security/detect-object-injection -- 从内部枚举构造的键
    acc[nodeType] = (acc[nodeType] ?? 0) + 1;
    return acc;
  }, {});
};

const emptyMemoryBlockDiagnostics = (): ContextMemoryBlockDiagnostics => ({
  evaluated: [],
  inserted: [],
  delayed: [],
  cooling: [],
  retained: [],
  inactive: []
});

export const createContextService = ({
  context,
  memoryService = createMemoryService({ context }),
  overlayStore = createContextOverlayStore(context),
  longMemoryBlockStore = createPrismaLongMemoryBlockStore(context)
}: CreateContextServiceOptions): ContextService => {
  return {
    async buildContextRun(input) {
      const memoryResult = await memoryService.buildMemoryContext({
        actor_ref: input.actor_ref as never,
        resolved_agent_id: input.resolved_agent_id
      });

      const pluginAdapters = input.pack_id ? pluginRuntimeRegistry.getContextSourceAdapters(input.pack_id) : [];
      const adapters = [
        ...createDefaultContextSourceAdapters({ context, overlayStore, longMemoryBlockStore }),
        ...pluginAdapters
      ];
      const built = await buildContextNodesFromSources(adapters, {
        tick: input.tick,
        actor_ref: input.actor_ref,
        identity: input.identity ?? null,
        resolved_agent_id: input.resolved_agent_id,
        memory_selection: memoryResult.selection,
        policy_summary: input.policy_summary ?? null,
        pack_state: input.pack_state ?? null,
        pack_id: input.pack_id ?? null
      });

      const droppedNodes = memoryResult.selection.dropped.map((entry) => ({
        node_id: entry.entry_id,
        reason: entry.reason,
        source_kind: null,
        node_type: null
      }));

      const selection: ContextSelectionResult = {
        nodes: built.nodes,
        dropped_nodes: droppedNodes
      };

      const policyResult = evaluateContextPolicies(selection.nodes);
      const policySelection = applyPolicyDecisionsToSelection(selection, policyResult);

      const overlayNodesLoaded: ContextOverlayLoadedNode[] = policySelection.nodes
        .filter(node => node.source_kind === 'overlay')
        .map(node => ({
          node_id: node.id,
          overlay_id: typeof node.source_ref?.overlay_id === 'string' ? node.source_ref.overlay_id : node.id,
          overlay_type: typeof node.metadata?.overlay_type === 'string' ? node.metadata.overlay_type : 'overlay_entry',
          persistence_mode: typeof node.metadata?.persistence_mode === 'string' ? node.metadata.persistence_mode : 'sticky',
          created_by: node.provenance.created_by === 'agent' ? 'agent' : 'system',
          status: typeof node.metadata?.overlay_status === 'string' ? node.metadata.overlay_status : 'active',
          preferred_slot: node.placement_policy.preferred_slot
        }));

      const memoryBlockDiagnostics =
        built.diagnostics['memory-block-runtime'] && typeof built.diagnostics['memory-block-runtime'] === 'object'
          ? ((built.diagnostics['memory-block-runtime'] as { memory_blocks?: ContextMemoryBlockDiagnostics }).memory_blocks ?? emptyMemoryBlockDiagnostics())
          : emptyMemoryBlockDiagnostics();

      const diagnosticsBase = {
        source_adapter_names: built.adapter_names,
        node_count: policySelection.nodes.length,
        node_counts_by_type: buildNodeCountsByType(policySelection.nodes.map(node => node.node_type)),
        selected_node_ids: policySelection.nodes.map(node => node.id),
        dropped_nodes: policySelection.dropped_nodes,
        policy_decisions: policyResult.policy_decisions,
        blocked_nodes: policyResult.blocked_nodes,
        locked_nodes: policyResult.locked_nodes,
        visibility_denials: policyResult.visibility_denials,
        overlay_nodes_loaded: overlayNodesLoaded,
        overlay_nodes_mutated: [],
        memory_blocks: memoryBlockDiagnostics,
        submitted_directives: [],
        approved_directives: [],
        denied_directives: [],
        selected_node_summaries: policySelection.nodes.map(node => ({
          id: node.id,
          node_type: node.node_type,
          source_kind: node.source_kind,
          preferred_slot: node.placement_policy.preferred_slot
        }))
      };

      const contextRun: ContextRun = {
        id: randomUUID(),
        created_at_tick: input.tick.toString(),
        nodes: policySelection.nodes,
        selected_node_ids: policySelection.nodes.map(node => node.id),
        diagnostics: {
          ...diagnosticsBase
        }
      };

      const selectedEntries: MemoryEntry[] = [];
      for (const node of contextRun.nodes) {
        if (node.source_kind === 'overlay') continue;
        const sourceKind = node.source_kind as MemorySourceKind;
        if (!['trace', 'intent', 'job', 'post', 'event', 'summary', 'manual'].includes(sourceKind)) continue;
        const preferredSlot = node.placement_policy.preferred_slot;
        if (preferredSlot !== 'memory_short_term' && preferredSlot !== 'memory_long_term' && preferredSlot !== 'memory_summary') continue;
        const scope = preferredSlot === 'memory_long_term' ? 'long_term' as const : 'short_term' as const;
        selectedEntries.push({
          id: node.id,
          scope,
          actor_ref: (node.actor_ref && typeof node.actor_ref === 'object' && !Array.isArray(node.actor_ref) ? node.actor_ref as unknown as MemoryEntry['actor_ref'] : null),
          source_kind: sourceKind,
          source_ref: node.source_ref ? { ...node.source_ref } as MemoryEntry['source_ref'] : null,
          content: { text: node.content.text, ...(node.content.structured ? { structured: node.content.structured } : {}) },
          tags: node.tags,
          importance: node.importance,
          salience: node.salience,
          confidence: node.confidence ?? null,
          visibility: { policy_gate: typeof node.visibility.policy_gate === 'string' ? node.visibility.policy_gate : null },
          created_at: node.created_at,
          occurred_at: node.occurred_at ?? null,
          expires_at: node.expires_at ?? null,
          metadata: { node_type: node.node_type, ...(node.metadata ? { context_metadata: node.metadata } : {}) }
        });
      }

      const shortTerm = selectedEntries.filter(e => e.scope === 'short_term' && e.source_kind !== 'summary');
      const longTerm = selectedEntries.filter(e => e.scope === 'long_term');
      const summaries = selectedEntries.filter(e => e.source_kind === 'summary');
      const dropped = contextRun.diagnostics.dropped_nodes.map(d => ({ entry_id: d.node_id, reason: d.reason }));

      const memoryContext: MemoryContextPack = {
        short_term: shortTerm,
        long_term: longTerm,
        summaries,
        diagnostics: {
          selected_count: selectedEntries.length,
          skipped_count: dropped.length,
          memory_selection: { selected_entry_ids: selectedEntries.map(e => e.id), dropped },
          prompt_processing_trace: null
        }
      };

      return {
        context_run: contextRun,
        selection: policySelection,
        memory_context: memoryContext
      };
    }
  };
};
