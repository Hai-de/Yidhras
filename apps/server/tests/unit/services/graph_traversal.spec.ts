import { describe, expect, it } from 'vitest';

import {
  buildContainerNodeId,
  buildRelayNodeId,
  getNeighborhoodNodeIds
} from '../../../src/app/services/relational/graph_traversal.js';

describe('graph_traversal', () => {
  describe('buildRelayNodeId', () => {
    it('prepends relay: prefix', () => {
      expect(buildRelayNodeId('intent-1')).toBe('relay:intent-1');
    });

    it('handles empty string', () => {
      expect(buildRelayNodeId('')).toBe('relay:');
    });
  });

  describe('buildContainerNodeId', () => {
    it('prepends container: prefix', () => {
      expect(buildContainerNodeId('intent-2')).toBe('container:intent-2');
    });

    it('handles empty string', () => {
      expect(buildContainerNodeId('')).toBe('container:');
    });
  });

  describe('getNeighborhoodNodeIds', () => {
    it('returns only root when depth is 0', () => {
      const result = getNeighborhoodNodeIds('root', 0, [], [], []);
      expect(result).toEqual(new Set(['root']));
    });

    it('returns only root when no edges exist', () => {
      const result = getNeighborhoodNodeIds('root', 3, [], [], []);
      expect(result).toEqual(new Set(['root']));
    });

    it('traverses relationships bidirectionally at depth 1', () => {
      const relationships = [
        { from_id: 'root', to_id: 'child1' },
        { from_id: 'root', to_id: 'child2' }
      ];
      const result = getNeighborhoodNodeIds('root', 1, relationships, [], []);

      expect(result).toEqual(new Set(['root', 'child1', 'child2']));
    });

    it('traverses reverse relationships', () => {
      const relationships = [
        { from_id: 'parent', to_id: 'root' }
      ];
      const result = getNeighborhoodNodeIds('root', 1, relationships, [], []);

      expect(result).toEqual(new Set(['root', 'parent']));
    });

    it('traverses multi-hop at depth 2', () => {
      const relationships = [
        { from_id: 'root', to_id: 'level1' },
        { from_id: 'level1', to_id: 'level2' }
      ];
      const result = getNeighborhoodNodeIds('root', 2, relationships, [], []);

      expect(result).toEqual(new Set(['root', 'level1', 'level2']));
    });

    it('stops at depth boundary', () => {
      const relationships = [
        { from_id: 'root', to_id: 'level1' },
        { from_id: 'level1', to_id: 'level2' }
      ];
      const result = getNeighborhoodNodeIds('root', 1, relationships, [], []);

      expect(result.has('level2')).toBe(false);
    });

    it('includes atmosphere nodes owned by visited nodes', () => {
      const atmosphereNodes = [
        { id: 'atmo-1', owner_id: 'root' }
      ];
      const result = getNeighborhoodNodeIds('root', 1, [], atmosphereNodes, []);

      expect(result).toEqual(new Set(['root', 'atmo-1']));
    });

    it('does not include atmosphere nodes owned by non-visited nodes', () => {
      const atmosphereNodes = [
        { id: 'atmo-1', owner_id: 'other' }
      ];
      const result = getNeighborhoodNodeIds('root', 1, [], atmosphereNodes, []);

      expect(result).toEqual(new Set(['root']));
    });

    it('creates relay node from agent to action intent', () => {
      const actionIntents = [
        { id: 'intent-1', actor_ref: { agent_id: 'root' }, source_inference_id: 'inf-1', status: 'pending' }
      ];
      const result = getNeighborhoodNodeIds('root', 1, [], [], actionIntents);

      expect(result.has('relay:intent-1')).toBe(true);
    });

    it('creates container node only for failed intents', () => {
      const actionIntents = [
        { id: 'intent-fail', actor_ref: { agent_id: 'root' }, source_inference_id: 'inf-1', status: 'failed' }
      ];
      const result = getNeighborhoodNodeIds('root', 1, [], [], actionIntents);

      expect(result.has('container:intent-fail')).toBe(true);
    });

    it('does not create container node for non-failed intents', () => {
      const actionIntents = [
        { id: 'intent-ok', actor_ref: { agent_id: 'root' }, source_inference_id: 'inf-1', status: 'pending' }
      ];
      const result = getNeighborhoodNodeIds('root', 1, [], [], actionIntents);

      expect(result.has('container:intent-ok')).toBe(false);
    });

    it('handles actor_ref without agent_id', () => {
      const actionIntents = [
        { id: 'intent-1', actor_ref: { unknown_field: 'x' }, source_inference_id: 'inf-1', status: 'pending' }
      ];
      const result = getNeighborhoodNodeIds('root', 1, [], [], actionIntents);

      expect(result).toEqual(new Set(['root']));
    });

    it('traverses relay back to agent', () => {
      const actionIntents = [
        { id: 'intent-1', actor_ref: { agent_id: 'agent-A' }, source_inference_id: 'inf-1', status: 'pending' }
      ];
      // Start from the relay node, should reach back to agent-A
      const result = getNeighborhoodNodeIds('relay:intent-1', 1, [], [], actionIntents);

      expect(result.has('agent-A')).toBe(true);
    });

    it('traverses container to relay', () => {
      const actionIntents = [
        { id: 'intent-1', actor_ref: { agent_id: 'agent-A' }, source_inference_id: 'inf-1', status: 'failed' }
      ];
      const result = getNeighborhoodNodeIds('container:intent-1', 1, [], [], actionIntents);

      expect(result.has('relay:intent-1')).toBe(true);
    });

    it('handles cycles without infinite loop', () => {
      const relationships = [
        { from_id: 'a', to_id: 'b' },
        { from_id: 'b', to_id: 'a' }
      ];
      const result = getNeighborhoodNodeIds('a', 5, relationships, [], []);

      expect(result).toEqual(new Set(['a', 'b']));
    });
  });
});
