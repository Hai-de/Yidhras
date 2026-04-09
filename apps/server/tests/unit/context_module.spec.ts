import { describe, expect, it } from 'vitest';

import type { AppContext } from '../../src/app/context.js';
import type { ContextOverlayStore } from '../../src/context/overlay/types.js';
import { createContextService } from '../../src/context/service.js';
import type {
  InferencePackStateSnapshot,
  InferencePolicySummary
} from '../../src/inference/types.js';
import type { BuildMemoryContextInput, MemoryService } from '../../src/memory/service.js';
import type { MemoryContextPack, MemoryEntry, MemorySelectionResult } from '../../src/memory/types.js';


const buildMemoryEntry = (input: {
  id: string;
  source_kind: MemoryEntry['source_kind'];
  scope?: MemoryEntry['scope'];
  text: string;
  importance?: number;
  salience?: number;
}): MemoryEntry => ({
  id: input.id,
  scope: input.scope ?? 'short_term',
  source_kind: input.source_kind,
  source_ref: { trace_id: input.id },
  content: { text: input.text },
  tags: [input.source_kind],
  importance: input.importance ?? 0.5,
  salience: input.salience ?? 0.5,
  visibility: { policy_gate: 'allow' },
  created_at: '1000',
  occurred_at: '1000',
  metadata: { fixture: true }
});

const buildMemoryServiceStub = (selection: MemorySelectionResult): MemoryService => ({
  async buildMemoryContext(_input: BuildMemoryContextInput): Promise<{
    selection: MemorySelectionResult;
    context_pack: MemoryContextPack;
  }> {
    return {
      selection,
      context_pack: {
        short_term: selection.short_term,
        long_term: selection.long_term,
        summaries: selection.summaries,
        diagnostics: selection.diagnostics
      }
    };
  }
});

const buildOverlayStoreStub = (): ContextOverlayStore => ({
  async listEntries() {
    return [
      {
        id: 'overlay-1',
        actor_id: 'agent-001',
        pack_id: 'world-death-note',
        overlay_type: 'self_note',
        title: 'Kill target memo',
        content_text: 'Need a name and face confirmation before acting.',
        content_structured: { target_id: 'l-target' },
        tags: ['overlay', 'targeting'],
        status: 'active',
        persistence_mode: 'sticky',
        source_node_ids: ['trace-1'],
        created_by: 'system',
        created_at_tick: '995',
        updated_at_tick: '999'
      }
    ];
  },
  async createEntry(input) {
    throw new Error(`unexpected createEntry call in test: ${JSON.stringify(input)}`);
  }
});

const buildContext = (): AppContext => ({
  prisma: {} as AppContext['prisma'],
  sim: {
    getCurrentTick() {
      return 1000n;
    }
  } as AppContext['sim'],
  notifications: {
    push(level, content) {
      return { id: 'noop', level, content, timestamp: Date.now() };
    },
    getMessages() {
      return [];
    },
    clear() {
      // noop
    }
  },
  startupHealth: {
    level: 'ok',
    checks: {
      db: true,
      world_pack_dir: true,
      world_pack_available: true
    },
    available_world_packs: ['world-death-note'],
    errors: []
  },
  getRuntimeReady() {
    return true;
  },
  setRuntimeReady() {
    // noop
  },
  getPaused() {
    return false;
  },
  setPaused() {
    // noop
  },
  assertRuntimeReady() {
    // noop
  }
});

describe('context module service', () => {
  it('builds a context run from memory selection and runtime state snapshots while preserving legacy compatibility', async () => {
    const selection: MemorySelectionResult = {
      short_term: [
        buildMemoryEntry({ id: 'trace-1', source_kind: 'trace', text: 'trace entry' }),
        buildMemoryEntry({ id: 'event-1', source_kind: 'event', text: 'event entry' })
      ],
      long_term: [buildMemoryEntry({ id: 'manual-1', source_kind: 'manual', scope: 'long_term', text: 'manual note' })],
      summaries: [buildMemoryEntry({ id: 'summary-1', source_kind: 'summary', text: 'summary entry' })],
      dropped: [{ entry_id: 'dropped-1', reason: 'short_term_limit_exceeded' }],
      diagnostics: {
        selected_count: 4,
        skipped_count: 1,
        memory_selection: {
          selected_entry_ids: ['trace-1', 'event-1', 'manual-1', 'summary-1'],
          dropped: [{ entry_id: 'dropped-1', reason: 'short_term_limit_exceeded' }]
        }
      }
    };

    const policySummary: InferencePolicySummary = {
      social_post_read_allowed: true,
      social_post_readable_fields: ['id', 'content'],
      social_post_write_allowed: false,
      social_post_writable_fields: []
    };

    const packState: InferencePackStateSnapshot = {
      actor_roles: ['planner'],
      actor_state: {
        knows_notebook_power: true,
        murderous_intent: true
      },
      owned_artifacts: [
        {
          id: 'artifact-death-note',
          state: {
            holder_agent_id: 'agent-001'
          }
        }
      ],
      world_state: {
        kira_case_phase: 'kira_active'
      },
      latest_event: {
        event_id: 'evt-1',
        title: 'Suspicious death occurred',
        type: 'history',
        semantic_type: 'suspicious_death_occurred',
        created_at: '999'
      }
    };

    const service = createContextService({
      context: buildContext(),
      memoryService: buildMemoryServiceStub(selection),
      overlayStore: buildOverlayStoreStub()
    });

    const result = await service.buildContextRun({
      actor_ref: {
        identity_id: 'agent-001',
        identity_type: 'agent',
        role: 'active',
        agent_id: 'agent-001',
        atmosphere_node_id: null
      },
      resolved_agent_id: 'agent-001',
      tick: 1000n,
      policy_summary: policySummary,
      pack_state: packState,
      pack_id: 'world-death-note'
    });

    expect(result.context_run.nodes.length).toBeGreaterThan(selection.short_term.length + selection.long_term.length + selection.summaries.length);
    expect(result.context_run.diagnostics.source_adapter_names).toEqual(['legacy-memory-selection', 'runtime-state-snapshots', 'context-overlay-store']);
    expect(result.context_run.diagnostics.dropped_nodes).toEqual([
      {
        node_id: 'dropped-1',
        reason: 'short_term_limit_exceeded',
        source_kind: null,
        node_type: null
      }
    ]);

    const policyNode = result.context_run.nodes.find(node => node.node_type === 'policy_summary');
    expect(Array.isArray(result.context_run.diagnostics.policy_decisions)).toBe(true);
    expect(result.context_run.diagnostics.visibility_denials).toEqual([]);
    expect(Array.isArray(result.context_run.diagnostics.overlay_nodes_loaded)).toBe(true);
    expect(result.context_run.diagnostics.overlay_nodes_mutated).toEqual([]);
    expect(result.context_run.diagnostics.submitted_directives).toEqual([]);
    expect(result.context_run.diagnostics.approved_directives).toEqual([]);
    expect(result.context_run.diagnostics.denied_directives).toEqual([]);
    expect(result.context_run.diagnostics.locked_nodes?.some(node => node.node_id === policyNode?.id)).toBe(true);
    expect(result.context_run.nodes.some(node => node.id === policyNode?.id)).toBe(true);
    expect(result.selection.nodes.some(node => node.id === policyNode?.id)).toBe(true);

    expect(policyNode?.placement_policy.preferred_slot).toBe('system_policy');
    expect(policyNode?.visibility.level).toBe('visible_fixed');

    expect(result.context_run.diagnostics.selected_node_summaries?.some(summary => summary.node_type === 'policy_summary')).toBe(true);
    expect(result.context_run.diagnostics.compatibility).toEqual({
      legacy_memory_selected_count: 4,
      legacy_memory_dropped_count: 1,
      legacy_memory_context_selection_count: 4
    });

    const actorStateNode = result.context_run.nodes.find(node => node.node_type === 'pack_actor_state_snapshot');
    expect(actorStateNode?.content.structured?.murderous_intent).toBe(true);

    const latestEventNode = result.context_run.nodes.find(node => node.node_type === 'pack_latest_event_snapshot');
    expect(latestEventNode?.content.structured?.semantic_type).toBe('suspicious_death_occurred');

    const overlayNode = result.context_run.nodes.find(node => node.node_type === 'overlay_self_note');
    expect(overlayNode?.source_kind).toBe('overlay');
    expect(overlayNode?.visibility.level).toBe('writable_overlay');
    expect(overlayNode?.content.text).toContain('Kill target memo');
    expect(result.context_run.diagnostics.overlay_nodes_loaded).toEqual([
      expect.objectContaining({
        node_id: 'overlay-1',
        overlay_id: 'overlay-1'
      })
    ]);

    expect(result.memory_context.short_term.map(entry => entry.id)).toEqual(['trace-1', 'event-1']);
    expect(result.memory_context.long_term.map(entry => entry.id)).toEqual(['manual-1']);
    expect(result.memory_context.summaries.map(entry => entry.id)).toEqual(['summary-1']);
    expect(result.memory_context.diagnostics.memory_selection?.dropped).toEqual([
      {
        entry_id: 'dropped-1',
        reason: 'short_term_limit_exceeded'
      }
    ]);
  });
});
