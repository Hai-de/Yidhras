import { describe, expect, it } from 'vitest';

import {
  ACTOR_ENTITY_ID_SEPARATOR,
  packEntityIdFromResolvedAgentId
} from '../../../../src/packs/utils/pack_entity_id.js';

describe('pack_entity_id', () => {
  describe('ACTOR_ENTITY_ID_SEPARATOR', () => {
    it('is a colon', () => {
      expect(ACTOR_ENTITY_ID_SEPARATOR).toBe(':');
    });
  });

  describe('packEntityIdFromResolvedAgentId', () => {
    it('returns null for null agent ID', () => {
      expect(packEntityIdFromResolvedAgentId('pack-1', null)).toBeNull();
    });

    it('strips pack prefix from agent ID', () => {
      const result = packEntityIdFromResolvedAgentId('pack-1', 'pack-1:agent-1');
      expect(result).toBe('agent-1');
    });

    it('returns full ID when no prefix match', () => {
      const result = packEntityIdFromResolvedAgentId('pack-1', 'other-agent');
      expect(result).toBe('other-agent');
    });

    it('handles empty pack ID', () => {
      const result = packEntityIdFromResolvedAgentId('', 'agent-1');
      expect(result).toBe('agent-1');
    });

    it('handles agent ID equal to pack ID prefix only (no separator)', () => {
      // prefix is "pack-1:", resolvedAgentId is "pack-1" (no colon)
      const result = packEntityIdFromResolvedAgentId('pack-1', 'pack-1');
      expect(result).toBe('pack-1');
    });

    it('handles single-char packId with separator', () => {
      const result = packEntityIdFromResolvedAgentId('p', 'p:rest');
      expect(result).toBe('rest');
    });

    it('does not strip partial prefix match without separator', () => {
      // prefix is "pack-1:", resolvedAgentId starts with "pack-1" but has no colon
      const result = packEntityIdFromResolvedAgentId('pack-1', 'pack-10:agent');
      // "pack-10:agent" does NOT start with "pack-1:" (the 6th char is "0" not ":")
      expect(result).toBe('pack-10:agent');
    });
  });
});
