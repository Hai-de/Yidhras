import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createMemoryRecordingService } from '../../src/memory/recording/service.js';
import type { ContextOverlayStore } from '../../src/context/overlay/types.js';
import type { LongMemoryBlockStore, MemoryBlockRecord } from '../../src/memory/blocks/types.js';

const { upsertDeclaredPackCollectionRecord } = vi.hoisted(() => ({
  upsertDeclaredPackCollectionRecord: vi.fn(async () => null)
}));

vi.mock('../../src/packs/storage/pack_collection_repo.js', () => ({
  upsertDeclaredPackCollectionRecord
}));

const createOverlayStoreStub = (): ContextOverlayStore => ({
  async listEntries() {
    return [];
  },
  async getEntryById() {
    return null;
  },
  async createEntry(input) {
    return {
      id: `overlay:${input.overlay_type}:${input.actor_id}`,
      actor_id: input.actor_id,
      pack_id: input.pack_id ?? null,
      overlay_type: input.overlay_type,
      title: input.title ?? null,
      content_text: input.content_text,
      content_structured: input.content_structured ?? null,
      tags: input.tags ?? [],
      status: input.status ?? 'active',
      persistence_mode: input.persistence_mode ?? 'sticky',
      source_node_ids: input.source_node_ids ?? [],
      created_by: input.created_by,
      created_at_tick: input.created_at_tick,
      updated_at_tick: input.updated_at_tick ?? input.created_at_tick
    };
  },
  async updateEntry(input) {
    return {
      id: input.id,
      actor_id: 'agent-001',
      pack_id: 'world-death-note',
      overlay_type: 'target_dossier',
      title: input.title ?? null,
      content_text: input.content_text ?? '',
      content_structured: input.content_structured ?? null,
      tags: input.tags ?? [],
      status: input.status ?? 'active',
      persistence_mode: input.persistence_mode ?? 'persistent',
      source_node_ids: input.source_node_ids ?? [],
      created_by: 'system',
      created_at_tick: input.updated_at_tick,
      updated_at_tick: input.updated_at_tick
    };
  },
  async archiveEntry(input) {
    return {
      id: input.id,
      actor_id: 'agent-001',
      pack_id: 'world-death-note',
      overlay_type: 'self_note',
      title: null,
      content_text: '',
      content_structured: null,
      tags: [],
      status: 'archived',
      persistence_mode: 'sticky',
      source_node_ids: [],
      created_by: 'system',
      created_at_tick: input.updated_at_tick,
      updated_at_tick: input.updated_at_tick
    };
  }
});

const createMemoryBlockStoreStub = (): LongMemoryBlockStore => ({
  async listCandidateBlocks() {
    return [];
  },
  async upsertBlock(input) {
    return {
      block: input.block,
      behavior: input.behavior,
      state: null
    } satisfies MemoryBlockRecord;
  },
  async updateRuntimeState(state) {
    return state;
  },
  async hardDeleteBlock() {
    return undefined;
  }
});

describe('memory recording service pack collection bridge', () => {
  beforeEach(() => {
    upsertDeclaredPackCollectionRecord.mockClear();
  });

  it('writes reviseJudgementPlan into judgement_plans collection', async () => {
    const service = createMemoryRecordingService({
      context: {} as never,
      overlayStore: createOverlayStoreStub(),
      longMemoryBlockStore: createMemoryBlockStoreStub()
    });

    await service.reviseJudgementPlan({
      actor_id: 'agent-001',
      pack_id: 'world-death-note',
      tick: '1000',
      source_inference_id: 'trace-plan',
      reasoning: '夜神月重新规划了执行顺序。',
      semantic_intent_kind: 'revise_judgement_plan',
      target_ref: { entity_id: 'agent-002', kind: 'actor' }
    });

    expect(upsertDeclaredPackCollectionRecord).toHaveBeenCalledWith(
      'world-death-note',
      'judgement_plans',
      expect.objectContaining({
        owner_actor_id: 'agent-001',
        target_entity_id: 'agent-002'
      })
    );
  });

  it('writes updateTargetDossier into target_dossiers collection', async () => {
    const service = createMemoryRecordingService({
      context: {} as never,
      overlayStore: createOverlayStoreStub(),
      longMemoryBlockStore: createMemoryBlockStoreStub()
    });

    await service.updateTargetDossier({
      actor_id: 'agent-001',
      pack_id: 'world-death-note',
      tick: '1001',
      source_inference_id: 'trace-dossier',
      reasoning: '夜神月把目标线索整理成 dossier。',
      semantic_intent_kind: 'update_target_dossier',
      target_ref: { entity_id: 'agent-003', kind: 'actor' }
    });

    expect(upsertDeclaredPackCollectionRecord).toHaveBeenCalledWith(
      'world-death-note',
      'target_dossiers',
      expect.objectContaining({
        owner_actor_id: 'agent-001',
        target_entity_id: 'agent-003'
      })
    );
  });

  it('writes recordExecutionReflection into investigation_threads collection', async () => {
    const service = createMemoryRecordingService({
      context: {} as never,
      overlayStore: createOverlayStoreStub(),
      longMemoryBlockStore: createMemoryBlockStoreStub()
    });

    await service.recordExecutionReflection({
      actor_id: 'agent-001',
      pack_id: 'world-death-note',
      tick: '1002',
      source_inference_id: 'trace-postmortem',
      source_action_intent_id: 'intent-postmortem',
      intent_type: 'record_execution_postmortem',
      outcome: 'completed',
      reason: '夜神月记录了这次行动的余波。',
      semantic_intent_kind: 'record_execution_postmortem',
      target_ref: { entity_id: 'agent-002', kind: 'actor' },
      event_summaries: [{ id: 'evt-001', type: 'history', title: '夜神月私下复盘了最近一次行动' }]
    });

    expect(upsertDeclaredPackCollectionRecord).toHaveBeenCalledWith(
      'world-death-note',
      'investigation_threads',
      expect.objectContaining({
        owner_actor_id: 'agent-001',
        subject_entity_id: 'agent-002'
      })
    );
  });
});
