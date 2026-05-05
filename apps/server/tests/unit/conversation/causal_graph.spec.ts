import { describe, expect, it } from 'vitest';

import { CausalGraphQuery } from '../../../src/conversation/causal_graph.js';
import type {
  AgentConversationMemory,
  ConversationEntry
} from '../../../src/conversation/types.js';

function makeEntry(overrides: Partial<ConversationEntry> = {}): ConversationEntry {
  return {
    id: `entry-${Math.random().toString(36).slice(2, 8)}`,
    turn_number: 1,
    speaker_agent_id: 'agent-a',
    kind: 'original',
    original_content: 'test',
    current_content: 'test',
    provenance: {
      operator: { kind: 'agent', id: 'agent-a' },
      capability: 'conversation.record'
    },
    recorded_at: Date.now(),
    modifications: [],
    ...overrides
  };
}

function makeMemory(entries: ConversationEntry[]): AgentConversationMemory {
  return {
    id: 'mem-test',
    owner_agent_id: 'agent-a',
    conversation_id: 'conv-test',
    entries
  };
}

describe('CausalGraphQuery', () => {
  describe('getDerivedSummaries (forward)', () => {
    it('returns summaries that derive from the given entry', () => {
      const original = makeEntry({ id: 'entry-1', turn_number: 1 });
      const summary = makeEntry({
        id: 'summary-1',
        kind: 'summary',
        turn_number: 10,
        derived_from_entry_ids: ['entry-1']
      });

      const query = new CausalGraphQuery(makeMemory([original, summary]));

      const derived = query.getDerivedSummaries('entry-1');
      expect(derived).toHaveLength(1);
      expect(derived[0].id).toBe('summary-1');
    });

    it('returns empty array when entry has no derived summaries', () => {
      const original = makeEntry({ id: 'entry-1' });
      const query = new CausalGraphQuery(makeMemory([original]));
      expect(query.getDerivedSummaries('entry-1')).toHaveLength(0);
    });

    it('returns empty array for non-existent entry', () => {
      const query = new CausalGraphQuery(makeMemory([]));
      expect(query.getDerivedSummaries('nonexistent')).toHaveLength(0);
    });
  });

  describe('getSourceEntries (backward)', () => {
    it('returns source entries that were compressed into the summary', () => {
      const a = makeEntry({ id: 'entry-a', turn_number: 1 });
      const b = makeEntry({ id: 'entry-b', turn_number: 2 });
      const summary = makeEntry({
        id: 'summary-1',
        kind: 'summary',
        turn_number: 3,
        derived_from_entry_ids: ['entry-a', 'entry-b']
      });

      const query = new CausalGraphQuery(makeMemory([a, b, summary]));

      const sources = query.getSourceEntries('summary-1');
      expect(sources).toHaveLength(2);
      expect(sources.map((s) => s.id).sort()).toEqual(['entry-a', 'entry-b']);
    });

    it('returns empty array when summary has no source entries', () => {
      const summary = makeEntry({ id: 'summary-1', kind: 'summary' });
      const query = new CausalGraphQuery(makeMemory([summary]));
      expect(query.getSourceEntries('summary-1')).toHaveLength(0);
    });
  });

  describe('getCausalChain (bidirectional BFS)', () => {
    it('traces forward chain from original entry through multiple summary layers', () => {
      const original = makeEntry({ id: 'entry-1', turn_number: 1 });
      const summary1 = makeEntry({
        id: 'summary-1',
        kind: 'summary',
        turn_number: 5,
        derived_from_entry_ids: ['entry-1']
      });
      const summary2 = makeEntry({
        id: 'summary-2',
        kind: 'summary',
        turn_number: 10,
        derived_from_entry_ids: ['summary-1']
      });

      const query = new CausalGraphQuery(makeMemory([original, summary1, summary2]));

      const chain = query.getCausalChain('entry-1', { direction: 'forward' });
      expect(chain.derived).toHaveLength(2);
    });

    it('traces backward chain from summary to sources', () => {
      const a = makeEntry({ id: 'entry-a', turn_number: 1 });
      const b = makeEntry({ id: 'entry-b', turn_number: 2 });
      const summary = makeEntry({
        id: 'summary-1',
        kind: 'summary',
        turn_number: 3,
        derived_from_entry_ids: ['entry-a', 'entry-b']
      });

      const query = new CausalGraphQuery(makeMemory([a, b, summary]));

      const chain = query.getCausalChain('summary-1', { direction: 'backward' });
      expect(chain.sources).toHaveLength(2);
    });

    it('respects maxDepth limit', () => {
      const entries: ConversationEntry[] = [];
      entries.push(makeEntry({ id: 'e0', turn_number: 0 }));

      for (let i = 1; i <= 5; i++) {
        entries.push(
          makeEntry({
            id: `s${i}`,
            kind: 'summary',
            turn_number: i,
            derived_from_entry_ids: [entries[entries.length - 1].id]
          })
        );
      }

      const query = new CausalGraphQuery(makeMemory(entries));

      const chain = query.getCausalChain('e0', { direction: 'forward', maxDepth: 2 });
      // Should only reach depth 2, not all 5 layers
      expect(chain.derived.length).toBeLessThanOrEqual(2);
    });

    it('handles self-referencing entries without infinite loop', () => {
      const entry = makeEntry({
        id: 'entry-1',
        turn_number: 1,
        derived_from_entry_ids: ['entry-1']
      });

      const query = new CausalGraphQuery(makeMemory([entry]));
      expect(() => query.getCausalChain('entry-1')).not.toThrow();
    });
  });

  describe('analyzeImpact', () => {
    it('reports multi-layer impact correctly', () => {
      const original = makeEntry({ id: 'entry-1', turn_number: 1 });
      const summary1 = makeEntry({
        id: 'summary-1',
        kind: 'summary',
        turn_number: 5,
        derived_from_entry_ids: ['entry-1']
      });
      const summary2 = makeEntry({
        id: 'summary-2',
        kind: 'summary',
        turn_number: 10,
        derived_from_entry_ids: ['summary-1']
      });

      const query = new CausalGraphQuery(makeMemory([original, summary1, summary2]));

      const impact = query.analyzeImpact('entry-1');
      expect(impact.depth).toBe(2);
      expect(impact.affectedSummaryIds).toHaveLength(2);
      expect(impact.layers[0]).toHaveLength(1);
      expect(impact.layers[0][0].id).toBe('summary-1');
      expect(impact.layers[1]).toHaveLength(1);
      expect(impact.layers[1][0].id).toBe('summary-2');
    });

    it('returns empty impact for independent entry', () => {
      const entry = makeEntry({ id: 'entry-1' });
      const query = new CausalGraphQuery(makeMemory([entry]));

      const impact = query.analyzeImpact('entry-1');
      expect(impact.depth).toBe(0);
      expect(impact.affectedSummaryIds).toHaveLength(0);
      expect(impact.layers).toHaveLength(0);
    });

    it('handles branching impact (one summary compressing multiple sources)', () => {
      const a = makeEntry({ id: 'entry-a', turn_number: 1 });
      const b = makeEntry({ id: 'entry-b', turn_number: 2 });
      const summary = makeEntry({
        id: 'summary-1',
        kind: 'summary',
        turn_number: 3,
        derived_from_entry_ids: ['entry-a', 'entry-b']
      });

      const query = new CausalGraphQuery(makeMemory([a, b, summary]));

      const impactA = query.analyzeImpact('entry-a');
      expect(impactA.affectedSummaryIds).toEqual(['summary-1']);

      const impactB = query.analyzeImpact('entry-b');
      expect(impactB.affectedSummaryIds).toEqual(['summary-1']);
    });

    it('caps depth at 10 layers', () => {
      const entries: ConversationEntry[] = [];
      entries.push(makeEntry({ id: 'e0', turn_number: 0 }));

      for (let i = 1; i <= 15; i++) {
        entries.push(
          makeEntry({
            id: `s${i}`,
            kind: 'summary',
            turn_number: i,
            derived_from_entry_ids: [entries[entries.length - 1].id]
          })
        );
      }

      const query = new CausalGraphQuery(makeMemory(entries));
      const impact = query.analyzeImpact('e0');
      expect(impact.depth).toBeLessThanOrEqual(10);
    });
  });

  describe('edge cases', () => {
    it('handles empty memory', () => {
      const query = new CausalGraphQuery(makeMemory([]));
      expect(query.getCausalChain('any').all).toHaveLength(0);
      expect(query.analyzeImpact('any').depth).toBe(0);
    });

    it('handles entries with null derived_from_entry_ids', () => {
      const entry = makeEntry({ id: 'e1', derived_from_entry_ids: undefined });
      const query = new CausalGraphQuery(makeMemory([entry]));
      expect(query.getSourceEntries('e1')).toHaveLength(0);
      expect(query.getDerivedSummaries('e1')).toHaveLength(0);
    });

    it('handles dangling derived_from_entry_ids (source entry not in memory)', () => {
      const summary = makeEntry({
        id: 'summary-1',
        kind: 'summary',
        derived_from_entry_ids: ['nonexistent-source']
      });
      const query = new CausalGraphQuery(makeMemory([summary]));
      expect(query.getSourceEntries('summary-1')).toHaveLength(0);
    });
  });
});
