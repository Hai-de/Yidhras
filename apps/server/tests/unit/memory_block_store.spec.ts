import { describe, expect, it } from 'vitest';

import { createPrismaLongMemoryBlockStore } from '../../src/memory/blocks/store.js';
import { createPrismaLongTermMemoryStore } from '../../src/memory/long_term_store.js';
import { createIsolatedAppContextFixture } from '../fixtures/isolated-db.js';

const TEST_PACK_ID = 'world-test-pack';

describe('memory block stores', () => {
  it('persists memory blocks, runtime state, supports hard delete, and exposes long-term memory entries', async () => {
    const fixture = await createIsolatedAppContextFixture();

    try {
      fixture.context.activePackRuntime = fixture.context.sim as typeof fixture.context.activePackRuntime;
      const blockStore = createPrismaLongMemoryBlockStore(fixture.context);
      const longTermStore = createPrismaLongTermMemoryStore(fixture.context);

      const record = await blockStore.upsertBlock({
        block: {
          id: 'memory-block-001',
          owner_agent_id: 'agent-001',
          pack_id: TEST_PACK_ID,
          kind: 'reflection',
          status: 'active',
          title: 'L suspicion',
          content_text: 'L may already be profiling the unusual death pattern.',
          content_structured: {
            risk: 'high',
            target: 'agent-002'
          },
          tags: ['investigation', 'risk'],
          keywords: ['L', 'death pattern'],
          source_ref: {
            source_kind: 'trace',
            source_id: 'trace-001',
            source_message_id: 'trace-001-message'
          },
          importance: 0.9,
          salience: 0.85,
          confidence: 0.8,
          created_at_tick: '1000',
          updated_at_tick: '1001'
        },
        behavior: {
          mutation: {
            allow_insert: true,
            allow_rewrite: true,
            allow_delete: true
          },
          placement: {
            slot: 'memory_long_term',
            anchor: null,
            mode: 'append',
            depth: 20,
            order: 1
          },
          activation: {
            mode: 'always',
            trigger_rate: 1,
            min_score: 0,
            triggers: []
          },
          retention: {
            retain_rounds_after_trigger: 0,
            cooldown_rounds_after_insert: 0,
            delay_rounds_before_insert: 0
          }
        }
      });

      expect(record.block.id).toBe('memory-block-001');
      expect(record.behavior.activation.mode).toBe('always');
      expect(record.state).toBeNull();

      const state = await blockStore.updateRuntimeState({
        memory_id: 'memory-block-001',
        trigger_count: 2,
        last_triggered_tick: '1002',
        last_inserted_tick: '1003',
        cooldown_until_tick: null,
        delayed_until_tick: null,
        retain_until_tick: '1005',
        currently_active: true,
        last_activation_score: 1,
        recent_distance_from_latest_message: 0
      });

      expect(state.currently_active).toBe(true);
      expect(state.retain_until_tick).toBe('1005');

      const listed = await blockStore.listCandidateBlocks({
        owner_agent_id: 'agent-001',
        pack_id: TEST_PACK_ID,
        limit: 10
      });

      expect(listed).toHaveLength(1);
      expect(listed[0]?.state?.recent_distance_from_latest_message).toBe(0);
      expect(listed[0]?.behavior.placement.depth).toBe(20);

      const longTermEntries = await longTermStore.search({
        actor_ref: {
          identity_id: 'identity-001',
          identity_type: 'user',
          role: 'active',
          agent_id: 'agent-001',
          atmosphere_node_id: null
        },
        limit: 4
      });

      expect(longTermEntries).toHaveLength(1);
      expect(longTermEntries[0]?.scope).toBe('long_term');
      expect(longTermEntries[0]?.source_kind).toBe('manual');
      expect(longTermEntries[0]?.content.text).toContain('L suspicion');
      expect(longTermEntries[0]?.metadata?.memory_kind).toBe('reflection');

      await blockStore.hardDeleteBlock({
        memory_id: 'memory-block-001',
        deleted_by: 'system',
        reason: 'cleanup'
      });

      const afterDelete = await blockStore.listCandidateBlocks({
        owner_agent_id: 'agent-001',
        pack_id: TEST_PACK_ID,
        limit: 10
      });
      expect(afterDelete).toHaveLength(0);

      const auditRows = await fixture.prisma.memoryBlockDeletionAudit.findMany({
        where: { memory_block_id: 'memory-block-001' }
      });
      expect(auditRows).toHaveLength(1);
      expect(auditRows[0]?.deleted_by).toBe('system');
    } finally {
      await fixture.cleanup();
    }
  });
});
