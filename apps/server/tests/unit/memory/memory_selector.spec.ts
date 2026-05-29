import { describe, expect, it } from 'vitest';

import { selectMemory, toMemoryContextPack } from '../../../src/memory/selector.js';

const makeEntry = (overrides: Record<string, unknown> = {}) => ({
  id: 'entry-1',
  scope: 'short_term' as const,
  source_kind: 'trace' as const,
  content: { text: 'memory content' },
  tags: [],
  importance: 5,
  salience: 5,
  created_at: '2024-01-01T00:00:00Z',
  ...overrides
});

describe('memory/selector', () => {
  describe('selectMemory', () => {
    it('returns empty selection for empty inputs', () => {
      const result = selectMemory({ short_term: [], long_term: [] });
      expect(result.short_term).toEqual([]);
      expect(result.long_term).toEqual([]);
      expect(result.summaries).toEqual([]);
      expect(result.dropped).toEqual([]);
    });

    it('sorts entries by importance and salience', () => {
      const low = makeEntry({ id: 'low', importance: 1, salience: 1 });
      const high = makeEntry({ id: 'high', importance: 9, salience: 9 });
      const result = selectMemory({ short_term: [low, high], long_term: [] });

      expect(result.short_term[0].id).toBe('high');
      expect(result.short_term[1].id).toBe('low');
    });

    it('uses created_at as tiebreaker when scores are equal', () => {
      const older = makeEntry({ id: 'older', importance: 5, salience: 5, created_at: '2024-01-01T00:00:00Z' });
      const newer = makeEntry({ id: 'newer', importance: 5, salience: 5, created_at: '2024-06-01T00:00:00Z' });
      const result = selectMemory({ short_term: [older, newer], long_term: [] });

      // newer should come first (lexicographic desc)
      expect(result.short_term[0].id).toBe('newer');
    });

    it('drops entries exceeding short_term_limit', () => {
      const entries = Array.from({ length: 12 }, (_, i) => makeEntry({
        id: `st-${i}`,
        importance: 10 - i,
        salience: 5
      }));
      const result = selectMemory({ short_term: entries, long_term: [], short_term_limit: 5 });

      expect(result.short_term.length).toBe(5);
      expect(result.dropped.length).toBe(7);
      expect(result.dropped[0].reason).toBe('short_term_limit_exceeded');
    });

    it('drops entries exceeding long_term_limit', () => {
      const entries = Array.from({ length: 8 }, (_, i) => makeEntry({
        id: `lt-${i}`,
        scope: 'long_term' as const,
        importance: 10 - i,
        salience: 5
      }));
      const result = selectMemory({ short_term: [], long_term: entries, long_term_limit: 3 });

      expect(result.long_term.length).toBe(3);
      expect(result.dropped.length).toBe(5);
      expect(result.dropped[0].reason).toBe('long_term_limit_exceeded');
    });

    it('uses default limits when not specified', () => {
      const shortTerm = Array.from({ length: 10 }, (_, i) => makeEntry({
        id: `st-${i}`,
        importance: 10 - i,
        salience: 5
      }));
      const longTerm = Array.from({ length: 6 }, (_, i) => makeEntry({
        id: `lt-${i}`,
        scope: 'long_term' as const,
        importance: 10 - i,
        salience: 5
      }));
      const result = selectMemory({ short_term: shortTerm, long_term: longTerm });

      expect(result.short_term.length).toBe(8); // default 8
      expect(result.long_term.length).toBe(4); // default 4
    });

    it('includes summaries in result', () => {
      const summaries = [makeEntry({ id: 'sum-1', source_kind: 'summary' as const })];
      const result = selectMemory({ short_term: [], long_term: [], summaries });

      expect(result.summaries.length).toBe(1);
      expect(result.summaries[0].id).toBe('sum-1');
    });

    it('counts diagnostics correctly', () => {
      const entries = Array.from({ length: 5 }, (_, i) => makeEntry({
        id: `e-${i}`,
        importance: 10 - i,
        salience: 5
      }));
      const result = selectMemory({
        short_term: entries.slice(0, 3),
        long_term: entries.slice(3),
        short_term_limit: 2,
        long_term_limit: 1
      });

      expect(result.diagnostics.selected_count).toBe(3); // 2 + 1 + 0 summaries
      expect(result.diagnostics.skipped_count).toBe(2); // 1 short + 1 long
    });

    it('no dropped when within limits', () => {
      const entries = [makeEntry({ id: 'a' }), makeEntry({ id: 'b' })];
      const result = selectMemory({ short_term: entries, long_term: [], short_term_limit: 5 });

      expect(result.dropped).toEqual([]);
    });
  });

  describe('toMemoryContextPack', () => {
    it('converts selection result to context pack', () => {
      const selection = selectMemory({
        short_term: [makeEntry({ id: 'st-1' })],
        long_term: [makeEntry({ id: 'lt-1', scope: 'long_term' as const })],
        summaries: [makeEntry({ id: 'sum-1', source_kind: 'summary' as const })]
      });

      const pack = toMemoryContextPack(selection);
      expect(pack.short_term.length).toBe(1);
      expect(pack.long_term.length).toBe(1);
      expect(pack.summaries.length).toBe(1);
      expect(pack.diagnostics).toBeDefined();
    });

    it('preserves diagnostics from selection', () => {
      const selection = selectMemory({ short_term: [], long_term: [] });
      const pack = toMemoryContextPack(selection);

      expect(pack.diagnostics.selected_count).toBe(0);
      expect(pack.diagnostics.skipped_count).toBe(0);
    });
  });
});
