import { describe, expect, it } from 'vitest';

import type { EngineOwnedStateSnapshot,PrismaStateSnapshot } from '../../../src/determinism/state_digest.js';
import { computeStateDigest } from '../../../src/determinism/state_digest.js';

const makePrismaData = (): PrismaStateSnapshot => ({
  agents: [],
  identities: [],
  identity_node_bindings: [],
  posts: [],
  relationships: [],
  memory_blocks: [],
  context_overlay_entries: [],
  memory_compaction_states: [],
  scenario_entity_states: []
});

const makeEngineOwnedData = (): EngineOwnedStateSnapshot => ({
  world_entities: [],
  entity_states: [],
  authority_grants: [],
  mediator_bindings: [],
  rule_execution_records: []
});

describe('state_digest', () => {
  describe('computeStateDigest', () => {
    it('returns digest result with expected shape', () => {
      const result = computeStateDigest('pack-1', '100', 'rev-1', makePrismaData());
      expect(result).toBeDefined();
      expect(result.packId).toBe('pack-1');
      expect(result.tick).toBe('100');
      expect(result.revision).toBe('rev-1');
      expect(typeof result.canonicalJson).toBe('string');
      expect(typeof result.sha256).toBe('string');
      expect(result.sha256).toMatch(/^[0-9a-f]{64}$/);
    });

    it('produces deterministic output for same input', () => {
      const data = makePrismaData();
      const r1 = computeStateDigest('pack-1', '100', 'rev-1', data);
      const r2 = computeStateDigest('pack-1', '100', 'rev-1', data);
      expect(r1.sha256).toBe(r2.sha256);
      expect(r1.canonicalJson).toBe(r2.canonicalJson);
    });

    it('produces different digest for different pack id', () => {
      const data = makePrismaData();
      const r1 = computeStateDigest('pack-1', '100', 'rev-1', data);
      const r2 = computeStateDigest('pack-2', '100', 'rev-1', data);
      expect(r1.sha256).not.toBe(r2.sha256);
    });

    it('produces different digest for different tick', () => {
      const data = makePrismaData();
      const r1 = computeStateDigest('pack-1', '100', 'rev-1', data);
      const r2 = computeStateDigest('pack-1', '200', 'rev-1', data);
      expect(r1.sha256).not.toBe(r2.sha256);
    });

    it('produces different digest for different data', () => {
      const data1 = makePrismaData();
      const data2: PrismaStateSnapshot = {
        ...makePrismaData(),
        agents: [{ id: 'agent-1', name: 'Agent 1' }]
      };
      const r1 = computeStateDigest('pack-1', '100', 'rev-1', data1);
      const r2 = computeStateDigest('pack-1', '100', 'rev-1', data2);
      expect(r1.sha256).not.toBe(r2.sha256);
    });

    it('sorts entities deterministically', () => {
      const data1: PrismaStateSnapshot = {
        ...makePrismaData(),
        agents: [
          { id: 'z-agent', name: 'Z' },
          { id: 'a-agent', name: 'A' }
        ]
      };
      const data2: PrismaStateSnapshot = {
        ...makePrismaData(),
        agents: [
          { id: 'a-agent', name: 'A' },
          { id: 'z-agent', name: 'Z' }
        ]
      };
      const r1 = computeStateDigest('pack-1', '100', 'rev-1', data1);
      const r2 = computeStateDigest('pack-1', '100', 'rev-1', data2);
      expect(r1.sha256).toBe(r2.sha256);
    });

    it('includes engine owned data when provided', () => {
      const prismaData = makePrismaData();
      const engineData = makeEngineOwnedData();
      computeStateDigest('pack-1', '100', 'rev-1', prismaData);
      const r2 = computeStateDigest('pack-1', '100', 'rev-1', prismaData, engineData);
      // Empty engine data should still produce valid output
      expect(r2.sha256).toBeDefined();
      expect(r2.sha256).toMatch(/^[0-9a-f]{64}$/);
    });

    it('produces different digest with non-empty engine data', () => {
      const prismaData = makePrismaData();
      const engineData: EngineOwnedStateSnapshot = {
        ...makeEngineOwnedData(),
        world_entities: [{ entity_id: 'e1', name: 'Entity 1' }]
      };
      const r1 = computeStateDigest('pack-1', '100', 'rev-1', prismaData);
      const r2 = computeStateDigest('pack-1', '100', 'rev-1', prismaData, engineData);
      expect(r1.sha256).not.toBe(r2.sha256);
    });

    it('canonicalJson is valid JSON', () => {
      const result = computeStateDigest('pack-1', '100', 'rev-1', makePrismaData());
      const parsed = JSON.parse(result.canonicalJson);
      expect(parsed).toBeDefined();
      expect(parsed.pack_id).toBe('pack-1');
      expect(parsed.tick).toBe('100');
      expect(parsed.revision).toBe('rev-1');
    });
  });
});
