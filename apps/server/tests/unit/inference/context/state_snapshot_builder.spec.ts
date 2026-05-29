import { describe, expect, it } from 'vitest';

import { buildPackStateSnapshot } from '../../../../src/inference/context/state_snapshot_builder.js';
import { makeMockPackStorageAdapter } from '../../../helpers/inference-mocks.js';
import { createMockPrisma } from '../../../helpers/prisma_mock.js';
import { expectDefined } from '../../../helpers/assertions.js';

describe('buildPackStateSnapshot', () => {
  const packId = 'test-pack';
  const DEFAULT_WORLD_ID = '__world__';

  // ── Empty projection → empty snapshot ─────────────────────
  describe('empty projection', () => {
    it('returns empty snapshot when no entity states exist', async () => {
      const prisma = createMockPrisma();
      prisma.event.findFirst.mockResolvedValue(null);
      prisma.event.findMany.mockResolvedValue([]);

      const adapter = makeMockPackStorageAdapter({ entityStateRows: [] });

      const result = await buildPackStateSnapshot(
        { prisma: prisma as never },
        adapter,
        { packId, resolvedAgentId: null, attributes: {} }
      );

      expect(result.actor_state).toBeNull();
      expect(result.world_state).toBeNull();
      expect(result.owned_artifacts).toEqual([]);
      expect(result.actor_roles).toEqual([]);
      expect(result.latest_event).toBeNull();
      expect(result.recent_events).toEqual([]);
    });
  });

  // ── Actor state extraction ────────────────────────────────
  describe('actor state extraction', () => {
    it('extracts actor state when entity_id matches resolvedAgentId and namespace is core', async () => {
      const prisma = createMockPrisma();
      prisma.event.findFirst.mockResolvedValue(null);
      prisma.event.findMany.mockResolvedValue([]);

      const actorState = { health: 100, position: { x: 0, y: 0 } };
      const adapter = makeMockPackStorageAdapter({
        entityStateRows: [
          { entity_id: 'pack-1:actor-1', state_namespace: 'core', state_json: actorState }
        ]
      });

      const result = await buildPackStateSnapshot(
        { prisma: prisma as never },
        adapter,
        { packId, resolvedAgentId: 'pack-1:actor-1', attributes: {} }
      );

      expect(result.actor_state).toEqual(actorState);
    });

    it('matches actor state using packEntityId when resolvedAgentId is bare', async () => {
      const prisma = createMockPrisma();
      prisma.event.findFirst.mockResolvedValue(null);
      prisma.event.findMany.mockResolvedValue([]);

      const actorState = { mood: 'happy' };
      // packEntityIdFromResolvedAgentId prepends packId: to bare agent IDs
      const adapter = makeMockPackStorageAdapter({
        entityStateRows: [
          { entity_id: 'test-pack:agent-5', state_namespace: 'core', state_json: actorState }
        ]
      });

      const result = await buildPackStateSnapshot(
        { prisma: prisma as never },
        adapter,
        { packId, resolvedAgentId: 'test-pack:agent-5', attributes: {} }
      );

      expect(result.actor_state).toEqual(actorState);
    });

    it('returns null actor_state when no matching entity', async () => {
      const prisma = createMockPrisma();
      prisma.event.findFirst.mockResolvedValue(null);
      prisma.event.findMany.mockResolvedValue([]);

      const adapter = makeMockPackStorageAdapter({
        entityStateRows: [
          { entity_id: 'other-entity', state_namespace: 'core', state_json: { x: 1 } }
        ]
      });

      const result = await buildPackStateSnapshot(
        { prisma: prisma as never },
        adapter,
        { packId, resolvedAgentId: 'pack-1:agent-1', attributes: {} }
      );

      expect(result.actor_state).toBeNull();
    });

    it('skips non-core namespace rows for actor matching', async () => {
      const prisma = createMockPrisma();
      prisma.event.findFirst.mockResolvedValue(null);
      prisma.event.findMany.mockResolvedValue([]);

      const adapter = makeMockPackStorageAdapter({
        entityStateRows: [
          { entity_id: 'pack-1:agent-1', state_namespace: 'custom', state_json: { data: 1 } }
        ]
      });

      const result = await buildPackStateSnapshot(
        { prisma: prisma as never },
        adapter,
        { packId, resolvedAgentId: 'pack-1:agent-1', attributes: {} }
      );

      // custom namespace not treated as actor state
      expect(result.actor_state).toBeNull();
    });
  });

  // ── World state extraction ────────────────────────────────
  describe('world state extraction', () => {
    it('extracts world state for DEFAULT_PACK_WORLD_ENTITY_ID with world namespace', async () => {
      const prisma = createMockPrisma();
      prisma.event.findFirst.mockResolvedValue(null);
      prisma.event.findMany.mockResolvedValue([]);

      const worldState = { season: 'winter', temperature: -5 };
      const adapter = makeMockPackStorageAdapter({
        entityStateRows: [
          { entity_id: DEFAULT_WORLD_ID, state_namespace: 'world', state_json: worldState }
        ]
      });

      const result = await buildPackStateSnapshot(
        { prisma: prisma as never },
        adapter,
        { packId, resolvedAgentId: null, attributes: {} }
      );

      expect(result.world_state).toEqual(worldState);
    });

    it('returns null world_state when no world namespace row exists', async () => {
      const prisma = createMockPrisma();
      prisma.event.findFirst.mockResolvedValue(null);
      prisma.event.findMany.mockResolvedValue([]);

      const adapter = makeMockPackStorageAdapter({
        entityStateRows: [
          { entity_id: DEFAULT_WORLD_ID, state_namespace: 'other', state_json: { x: 1 } }
        ]
      });

      const result = await buildPackStateSnapshot(
        { prisma: prisma as never },
        adapter,
        { packId, resolvedAgentId: null, attributes: {} }
      );

      expect(result.world_state).toBeNull();
    });
  });

  // ── Artifact extraction ───────────────────────────────────
  describe('artifact extraction', () => {
    it('extracts artifacts with artifact namespace', async () => {
      const prisma = createMockPrisma();
      prisma.event.findFirst.mockResolvedValue(null);
      prisma.event.findMany.mockResolvedValue([]);

      const artifactState = { durability: 80 };
      const adapter = makeMockPackStorageAdapter({
        entityStateRows: [
          { entity_id: 'item-sword', state_namespace: 'artifact', state_json: artifactState },
          { entity_id: 'item-shield', state_namespace: 'artifact', state_json: { durability: 50 } }
        ]
      });

      const result = await buildPackStateSnapshot(
        { prisma: prisma as never },
        adapter,
        { packId, resolvedAgentId: null, attributes: {} }
      );

      expect(result.owned_artifacts).toHaveLength(2);
      expect(result.owned_artifacts[0]).toEqual({ id: 'item-sword', state: artifactState });
      expect(result.owned_artifacts[1]).toEqual({ id: 'item-shield', state: { durability: 50 } });
    });

    it('returns empty artifacts when no artifact namespace rows', async () => {
      const prisma = createMockPrisma();
      prisma.event.findFirst.mockResolvedValue(null);
      prisma.event.findMany.mockResolvedValue([]);

      const adapter = makeMockPackStorageAdapter({ entityStateRows: [] });

      const result = await buildPackStateSnapshot(
        { prisma: prisma as never },
        adapter,
        { packId, resolvedAgentId: null, attributes: {} }
      );

      expect(result.owned_artifacts).toEqual([]);
    });
  });

  // ── Actor roles from attributes ───────────────────────────
  describe('actor_roles', () => {
    it('extracts actor_roles from attributes', async () => {
      const prisma = createMockPrisma();
      prisma.event.findFirst.mockResolvedValue(null);
      prisma.event.findMany.mockResolvedValue([]);

      const adapter = makeMockPackStorageAdapter({ entityStateRows: [] });

      const result = await buildPackStateSnapshot(
        { prisma: prisma as never },
        adapter,
        { packId, resolvedAgentId: null, attributes: { actor_roles: ['hero', 'villain'] } }
      );

      expect(result.actor_roles).toEqual(['hero', 'villain']);
    });

    it('filters non-string entries from actor_roles', async () => {
      const prisma = createMockPrisma();
      prisma.event.findFirst.mockResolvedValue(null);
      prisma.event.findMany.mockResolvedValue([]);

      const adapter = makeMockPackStorageAdapter({ entityStateRows: [] });

      const result = await buildPackStateSnapshot(
        { prisma: prisma as never },
        adapter,
        { packId, resolvedAgentId: null, attributes: { actor_roles: ['valid', 42, null, 'also-valid'] as unknown } }
      );

      expect(result.actor_roles).toEqual(['valid', 'also-valid']);
    });

    it('returns empty array when actor_roles is missing', async () => {
      const prisma = createMockPrisma();
      prisma.event.findFirst.mockResolvedValue(null);
      prisma.event.findMany.mockResolvedValue([]);

      const adapter = makeMockPackStorageAdapter({ entityStateRows: [] });

      const result = await buildPackStateSnapshot(
        { prisma: prisma as never },
        adapter,
        { packId, resolvedAgentId: null, attributes: {} }
      );

      expect(result.actor_roles).toEqual([]);
    });
  });

  // ── latest_event ──────────────────────────────────────────
  describe('latest_event', () => {
    it('maps latest event when found', async () => {
      const prisma = createMockPrisma();
      const eventRow = {
        id: 'evt-1',
        title: 'Storm approaches',
        type: 'weather',
        impact_data: JSON.stringify({ type: 'storm' }),
        tick: 100n,
        created_at: 900n
      };
      prisma.event.findFirst.mockResolvedValue(eventRow);
      prisma.event.findMany.mockResolvedValue([]);

      const adapter = makeMockPackStorageAdapter({ entityStateRows: [] });

      const result = await buildPackStateSnapshot(
        { prisma: prisma as never },
        adapter,
        { packId, resolvedAgentId: null, attributes: {} }
      );

      const latestEvent = expectDefined(result.latest_event);
      expect(latestEvent.event_id).toBe('evt-1');
      expect(latestEvent.title).toBe('Storm approaches');
      expect(latestEvent.type).toBe('weather');
      expect(latestEvent.tick).toBe('100');
    });

    it('returns null latest_event when none found', async () => {
      const prisma = createMockPrisma();
      prisma.event.findFirst.mockResolvedValue(null);
      prisma.event.findMany.mockResolvedValue([]);

      const adapter = makeMockPackStorageAdapter({ entityStateRows: [] });

      const result = await buildPackStateSnapshot(
        { prisma: prisma as never },
        adapter,
        { packId, resolvedAgentId: null, attributes: {} }
      );

      expect(result.latest_event).toBeNull();
    });

    it('handles null impact_data for latest_event', async () => {
      const prisma = createMockPrisma();
      prisma.event.findFirst.mockResolvedValue({
        id: 'evt-2',
        title: 'Silent',
        type: 'ambient',
        impact_data: null,
        tick: 50n,
        created_at: 500n
      });
      prisma.event.findMany.mockResolvedValue([]);

      const adapter = makeMockPackStorageAdapter({ entityStateRows: [] });

      const result = await buildPackStateSnapshot(
        { prisma: prisma as never },
        adapter,
        { packId, resolvedAgentId: null, attributes: {} }
      );

      const latestEvent2 = expectDefined(result.latest_event);
      expect(latestEvent2.semantic_type).toBeNull();
    });
  });

  // ── recent_events ─────────────────────────────────────────
  describe('recent_events', () => {
    it('fetches recent events with limit 20', async () => {
      const prisma = createMockPrisma();
      prisma.event.findFirst.mockResolvedValue(null);

      const events = Array.from({ length: 5 }, (_, i) => ({
        id: `evt-${i}`,
        title: `Event ${i}`,
        type: 'misc',
        impact_data: null,
        tick: BigInt(100 - i),
        created_at: BigInt(1000 - i * 10)
      }));
      prisma.event.findMany.mockResolvedValue(events);

      const adapter = makeMockPackStorageAdapter({ entityStateRows: [] });

      const result = await buildPackStateSnapshot(
        { prisma: prisma as never },
        adapter,
        { packId, resolvedAgentId: null, attributes: {} }
      );

      expect(result.recent_events).toHaveLength(5);
      expect(prisma.event.findMany).toHaveBeenCalledWith({
        where: { pack_id: packId },
        orderBy: { tick: 'desc' },
        take: 20,
        select: {
          id: true,
          title: true,
          type: true,
          impact_data: true,
          tick: true,
          created_at: true
        }
      });
    });

    it('returns empty array when findMany throws', async () => {
      const prisma = createMockPrisma();
      prisma.event.findFirst.mockResolvedValue(null);
      prisma.event.findMany.mockRejectedValue(new Error('DB error'));

      const adapter = makeMockPackStorageAdapter({ entityStateRows: [] });

      const result = await buildPackStateSnapshot(
        { prisma: prisma as never },
        adapter,
        { packId, resolvedAgentId: null, attributes: {} }
      );

      // Silent catch — should not throw
      expect(result.recent_events).toEqual([]);
    });

    it('throws when prisma is null (cannot access latest event)', async () => {
      const adapter = makeMockPackStorageAdapter({ entityStateRows: [] });

      await expect(
        buildPackStateSnapshot(
          // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- testing null prisma edge case
          { prisma: null as never },
          adapter,
          { packId, resolvedAgentId: null, attributes: {} }
        )
      ).rejects.toThrow();
    });
  });
});
