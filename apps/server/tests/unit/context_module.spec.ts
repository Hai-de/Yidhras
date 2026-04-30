import { describe, expect, it } from 'vitest';

import type { PrismaClient } from '@prisma/client';

import type { AppContext } from '../../src/app/context.js';
import type { ContextOverlayStore } from '../../src/context/overlay/types.js';
import { createContextService } from '../../src/context/service.js';
import type { IdentityContext } from '../../src/identity/types.js';
import type {
  InferencePackStateSnapshot,
  InferencePolicySummary
} from '../../src/inference/types.js';
import type { LongMemoryBlockStore, MemoryBehavior, MemoryBlock, MemoryRuntimeState } from '../../src/memory/blocks/types.js';
import type { BuildMemoryContextInput, MemoryService } from '../../src/memory/service.js';
import type { MemoryContextPack, MemoryEntry, MemorySelectionResult } from '../../src/memory/types.js';

import { wrapPrismaAsRepositories } from '../helpers/mock_repos.js';

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
        id: 'overlay-1', actor_id: 'agent-001', pack_id: 'world-death-note', overlay_type: 'self_note',
        title: 'Kill target memo', content_text: 'Need a name and face confirmation before acting.',
        content_structured: { target_id: 'l-target' }, tags: ['overlay', 'targeting'], status: 'active',
        persistence_mode: 'sticky', source_node_ids: ['trace-1'], created_by: 'system',
        created_at_tick: '995', updated_at_tick: '999'
      }
    ];
  },
  async createEntry(input) {
    throw new Error(`unexpected createEntry call in test: ${JSON.stringify(input)}`);
  },
  async getEntryById() { return null; },
  async updateEntry(input) { throw new Error(`unexpected updateEntry call: ${JSON.stringify(input)}`); },
  async archiveEntry(input) { throw new Error(`unexpected archiveEntry call: ${JSON.stringify(input)}`); }
});

const buildLongMemoryBlockStoreStub = (): LongMemoryBlockStore => ({
  async listCandidateBlocks() {
    const block: MemoryBlock = {
      id: 'memory-block-1', owner_agent_id: 'agent-001', pack_id: 'world-death-note', kind: 'reflection',
      status: 'active', title: 'Long suspicion memo', content_text: 'Suspicion remains high after the latest suspicious death.',
      content_structured: { risk: 'high' }, tags: ['memory-block', 'suspicion'], keywords: ['suspicion', 'death'],
      source_ref: { source_kind: 'trace', source_id: 'trace-1', source_message_id: 'trace-1' },
      importance: 0.88, salience: 0.77, confidence: 0.81, created_at_tick: '900', updated_at_tick: '999'
    };

    const behavior: MemoryBehavior = {
      mutation: { allow_insert: true, allow_rewrite: true, allow_delete: true },
      placement: { slot: 'memory_long_term', anchor: null, mode: 'append', depth: 10, order: 2 },
      activation: { mode: 'always', trigger_rate: 1, min_score: 0, triggers: [] },
      retention: { retain_rounds_after_trigger: 1, cooldown_rounds_after_insert: 0, delay_rounds_before_insert: 0 }
    };

    return [{ block, behavior, state: null }];
  },
  async upsertBlock() { throw new Error('unexpected upsertBlock call in test'); },
  async updateRuntimeState(state: MemoryRuntimeState) { return state; },
  async hardDeleteBlock() { throw new Error('unexpected hardDeleteBlock call in test'); }
});

const buildContext = (): AppContext => {
  const prisma = {
    policy: { findMany: async () => [] },
    inferenceTrace: {
      findMany: async () => [{
        id: 'trace-1', actor_ref: { agent_id: 'agent-001' }, strategy: 'rule_based',
        provider: 'rule_based', decision: { reasoning: 'Investigate the death pattern.' }, updated_at: 999n
      }]
    },
    actionIntent: { findMany: async () => [] },
    event: {
      findMany: async () => [{
        id: 'event-1', title: 'Suspicious death occurred', description: 'The pattern intensified.',
        type: 'history', impact_data: JSON.stringify({ semantic_type: 'suspicious_death_occurred' }),
        tick: 999n, source_action_intent: { actor_ref: { agent_id: 'agent-001' } }
      }]
    }
  } as unknown as AppContext['prisma'];
  const repos = wrapPrismaAsRepositories(prisma as PrismaClient);
  repos.narrative = {
    getPrisma: () => prisma as PrismaClient,
    queryEvents: async () => []
  } as unknown as typeof repos.narrative;

  return {
    repos,
    prisma,
  clock: { getCurrentTick() { return 1000n; } } as AppContext['clock'],
  notifications: {
    push(level, content) { return { id: 'noop', level, content, timestamp: Date.now() }; },
    getMessages() { return []; },
    clear() {}
  },
  startupHealth: {
    level: 'ok', checks: { db: true, world_pack_dir: true, world_pack_available: true },
    available_world_packs: ['world-death-note'], errors: []
  },
  getRuntimeReady() { return true; },
  setRuntimeReady() {},
  getPaused() { return false; },
  setPaused() {},
  assertRuntimeReady() {}
  };
};

const buildSelection = (): MemorySelectionResult => ({
  short_term: [
    buildMemoryEntry({ id: 'trace-1', source_kind: 'trace', text: 'trace entry' }),
    buildMemoryEntry({ id: 'event-1', source_kind: 'event', text: 'event entry' })
  ],
  long_term: [buildMemoryEntry({ id: 'manual-1', source_kind: 'manual', scope: 'long_term', text: 'manual note' })],
  summaries: [buildMemoryEntry({ id: 'summary-1', source_kind: 'summary', text: 'summary entry' })],
  dropped: [{ entry_id: 'dropped-1', reason: 'short_term_limit_exceeded' }],
  diagnostics: {
    selected_count: 4, skipped_count: 1,
    memory_selection: {
      selected_entry_ids: ['trace-1', 'event-1', 'manual-1', 'summary-1'],
      dropped: [{ entry_id: 'dropped-1', reason: 'short_term_limit_exceeded' }]
    }
  }
});

const buildPolicySummary = (): InferencePolicySummary => ({
  social_post_read_allowed: true, social_post_readable_fields: ['id', 'content'],
  social_post_write_allowed: false, social_post_writable_fields: []
});

const buildIdentity = (): IdentityContext => ({
  id: 'identity-001', type: 'user', name: 'Tester', provider: 'test', status: 'active', claims: null
});

const buildPackState = (): InferencePackStateSnapshot => ({
  actor_roles: ['planner'],
  actor_state: { knows_notebook_power: true, murderous_intent: true },
  owned_artifacts: [{ id: 'artifact-death-note', state: { holder_agent_id: 'agent-001' } }],
  world_state: { kira_case_phase: 'kira_active' },
  latest_event: { event_id: 'evt-1', title: 'Suspicious death occurred', type: 'history', semantic_type: 'suspicious_death_occurred', created_at: '999' }
});

const createService = () => {
  const selection = buildSelection();
  return createContextService({
    context: buildContext(),
    memoryService: buildMemoryServiceStub(selection),
    overlayStore: buildOverlayStoreStub(),
    longMemoryBlockStore: buildLongMemoryBlockStoreStub()
  });
};

const runContextBuild = async (service = createService()) => {
  return service.buildContextRun({
    actor_ref: { identity_id: 'identity-001', identity_type: 'user', role: 'active', agent_id: 'agent-001', atmosphere_node_id: null },
    identity: buildIdentity(),
    resolved_agent_id: 'agent-001',
    tick: 1000n,
    policy_summary: buildPolicySummary(),
    pack_state: buildPackState(),
    pack_id: 'world-death-note'
  });
};

describe('context module service', () => {
  it('produces a context run with nodes exceeding raw memory entries', async () => {
    const result = await runContextBuild();
    expect(result.context_run.nodes.length).toBeGreaterThan(0);
  });

  it('exposes the expected source adapter names in diagnostics', async () => {
    const result = await runContextBuild();
    expect(result.context_run.diagnostics.source_adapter_names).toEqual([
      'memory-selection', 'runtime-state-snapshots', 'memory-block-runtime', 'context-overlay-store'
    ]);
  });

  it('reports dropped nodes in diagnostics', async () => {
    const result = await runContextBuild();
    expect(result.context_run.diagnostics.dropped_nodes).toEqual([
      { node_id: 'dropped-1', reason: 'short_term_limit_exceeded', source_kind: null, node_type: null }
    ]);
  });

  it('includes a policy_summary node with correct placement and visibility', async () => {
    const result = await runContextBuild();
    const policyNode = result.context_run.nodes.find(node => node.node_type === 'policy_summary');

    expect(policyNode).toBeDefined();
    expect(policyNode?.placement_policy.preferred_slot).toBe('system_policy');
    expect(policyNode?.visibility.level).toBe('visible_fixed');
    expect(Array.isArray(result.context_run.diagnostics.policy_decisions)).toBe(true);
    expect(result.context_run.diagnostics.visibility_denials).toEqual([]);
  });

  it('locks the policy node in diagnostics', async () => {
    const result = await runContextBuild();
    const policyNode = result.context_run.nodes.find(node => node.node_type === 'policy_summary');
    expect(result.context_run.diagnostics.locked_nodes?.some(node => node.node_id === policyNode?.id)).toBe(true);
  });

  it('includes pack actor state snapshot node', async () => {
    const result = await runContextBuild();
    const actorStateNode = result.context_run.nodes.find(node => node.node_type === 'pack_actor_state_snapshot');
    expect(actorStateNode).toBeDefined();
    expect(actorStateNode?.content.structured?.murderous_intent).toBe(true);
  });

  it('includes pack latest event snapshot node', async () => {
    const result = await runContextBuild();
    const latestEventNode = result.context_run.nodes.find(node => node.node_type === 'pack_latest_event_snapshot');
    expect(latestEventNode).toBeDefined();
    expect(latestEventNode?.content.structured?.semantic_type).toBe('suspicious_death_occurred');
  });

  it('includes overlay entries as context nodes', async () => {
    const result = await runContextBuild();
    const overlayNode = result.context_run.nodes.find(node => node.node_type === 'overlay_self_note');
    expect(overlayNode).toBeDefined();
    expect(overlayNode?.source_kind).toBe('overlay');
    expect(overlayNode?.visibility.level).toBe('writable_overlay');
    expect(overlayNode?.content.text).toContain('Kill target memo');
    expect(result.context_run.diagnostics.overlay_nodes_loaded).toEqual([
      expect.objectContaining({ node_id: 'overlay-1', overlay_id: 'overlay-1' })
    ]);
    expect(result.context_run.diagnostics.overlay_nodes_mutated).toEqual([]);
  });

  it('includes memory block nodes with correct placement metadata', async () => {
    const result = await runContextBuild();
    const memoryBlockNode = result.context_run.nodes.find(node => node.node_type === 'memory_block_reflection');
    expect(memoryBlockNode).toBeDefined();
    expect(memoryBlockNode?.metadata?.memory_block_id).toBe('memory-block-1');
    expect(memoryBlockNode?.metadata?.placement_depth).toBe(10);
    expect(memoryBlockNode?.placement_policy.preferred_slot).toBe('memory_long_term');
  });

  it('evaluates and inserts memory blocks into diagnostics', async () => {
    const result = await runContextBuild();
    expect(result.context_run.diagnostics.memory_blocks).toEqual({
      evaluated: [expect.objectContaining({ memory_id: 'memory-block-1', status: 'active' })],
      inserted: ['memory-block-1'], delayed: [], cooling: [], retained: [], inactive: []
    });
  });

  it('preserves memory context with correct entry groupings', async () => {
    const result = await runContextBuild();
    expect(result.memory_context.short_term.map(entry => entry.id)).toEqual(['trace-1', 'event-1']);
    expect(result.memory_context.long_term.map(entry => entry.id).sort()).toEqual(['manual-1', 'memory-block-1']);
    expect(result.memory_context.summaries.map(entry => entry.id)).toEqual(['summary-1']);
    expect(result.memory_context.diagnostics.memory_selection?.dropped).toEqual([
      { entry_id: 'dropped-1', reason: 'short_term_limit_exceeded' }
    ]);
  });

  it('has empty directive arrays in initial build', async () => {
    const result = await runContextBuild();
    expect(result.context_run.diagnostics.submitted_directives).toEqual([]);
    expect(result.context_run.diagnostics.approved_directives).toEqual([]);
    expect(result.context_run.diagnostics.denied_directives).toEqual([]);
  });

  it('tracks policy summary in selected node summaries', async () => {
    const result = await runContextBuild();
    expect(result.context_run.diagnostics.selected_node_summaries?.some(s => s.node_type === 'policy_summary')).toBe(true);
  });
});
