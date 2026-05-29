import { describe, expect, it } from 'vitest';

import {
  parseGraphView,
  parseGraphDepth,
  parseGraphKinds,
  normalizeSearch,
  parseGraphViewFilters
} from '../../../src/app/services/relational/graph_filters.js';

describe('relational/graph_filters', () => {
  describe('parseGraphView', () => {
    it('returns tree for "tree"', () => {
      expect(parseGraphView('tree')).toBe('tree');
    });

    it('returns mesh for undefined', () => {
      expect(parseGraphView(undefined)).toBe('mesh');
    });

    it('returns mesh for non-tree value', () => {
      expect(parseGraphView('mesh')).toBe('mesh');
      expect(parseGraphView('other')).toBe('mesh');
      expect(parseGraphView('')).toBe('mesh');
    });
  });

  describe('parseGraphDepth', () => {
    it('returns default for undefined', () => {
      const result = parseGraphDepth(undefined);
      expect(typeof result).toBe('number');
      expect(result).toBeGreaterThan(0);
    });

    it('returns clamped value within range', () => {
      expect(parseGraphDepth(3)).toBe(3);
      expect(parseGraphDepth(0)).toBe(0);
    });

    it('truncates fractional values', () => {
      expect(parseGraphDepth(3.7)).toBe(3);
    });

    it('returns default for non-finite values', () => {
      expect(typeof parseGraphDepth(Infinity)).toBe('number');
      expect(typeof parseGraphDepth(NaN)).toBe('number');
      expect(typeof parseGraphDepth(-Infinity)).toBe('number');
    });

    it('clamps to non-negative', () => {
      expect(parseGraphDepth(-5)).toBe(0);
    });
  });

  describe('parseGraphKinds', () => {
    it('returns null for undefined', () => {
      expect(parseGraphKinds(undefined)).toBeNull();
    });

    it('returns null for empty array', () => {
      expect(parseGraphKinds([])).toBeNull();
    });

    it('returns null for whitespace-only strings', () => {
      expect(parseGraphKinds(['', '  '])).toBeNull();
    });

    it('accepts valid node kinds', () => {
      const validKinds = ['agent', 'atmosphere', 'relay', 'container'];
      for (const kind of validKinds) {
        const result = parseGraphKinds([kind]);
        expect(result).toEqual([kind]);
      }
    });

    it('deduplicates kinds', () => {
      const result = parseGraphKinds(['agent', 'agent', 'atmosphere']);
      expect(result).toEqual(['agent', 'atmosphere']);
    });

    it('trims whitespace from kinds', () => {
      const result = parseGraphKinds(['  agent  ', '  atmosphere  ']);
      expect(result).toEqual(['agent', 'atmosphere']);
    });

    it('throws for invalid kinds', () => {
      expect(() => parseGraphKinds(['agent', 'invalid_kind'])).toThrow();
    });
  });

  describe('normalizeSearch', () => {
    it('returns null for undefined', () => {
      expect(normalizeSearch(undefined)).toBeNull();
    });

    it('returns trimmed lowercase string', () => {
      expect(normalizeSearch('  Hello World  ')).toBe('hello world');
    });

    it('returns null for empty string', () => {
      expect(normalizeSearch('')).toBeNull();
    });

    it('returns null for whitespace-only string', () => {
      expect(normalizeSearch('   ')).toBeNull();
    });

    it('lowercases the value', () => {
      expect(normalizeSearch('ABC')).toBe('abc');
    });
  });

  describe('parseGraphViewFilters', () => {
    it('returns default filters for empty input', () => {
      const result = parseGraphViewFilters({});
      expect(result.view).toBe('mesh');
      expect(typeof result.depth).toBe('number');
      expect(result.kinds).toBeNull();
      expect(result.rootId).toBeNull();
      expect(result.search).toBeNull();
      expect(result.includeInactive).toBe(false);
      expect(result.includeUnresolved).toBe(true);
    });

    it('parses all fields', () => {
      const result = parseGraphViewFilters({
        view: 'tree',
        depth: 3,
        kinds: ['agent'],
        root_id: 'root-1',
        search: 'test',
        include_inactive: true,
        include_unresolved: false
      });
      expect(result.view).toBe('tree');
      expect(result.depth).toBe(3);
      expect(result.kinds).toEqual(['agent']);
      expect(result.rootId).toBe('root-1');
      expect(result.search).toBe('test');
      expect(result.includeInactive).toBe(true);
      expect(result.includeUnresolved).toBe(false);
    });

    it('trims root_id', () => {
      const result = parseGraphViewFilters({ root_id: '  root-1  ' });
      expect(result.rootId).toBe('root-1');
    });

    it('treats empty root_id as null', () => {
      expect(parseGraphViewFilters({ root_id: '' }).rootId).toBeNull();
      expect(parseGraphViewFilters({ root_id: '  ' }).rootId).toBeNull();
    });

    it('includeUnresolved defaults to true', () => {
      const result = parseGraphViewFilters({});
      expect(result.includeUnresolved).toBe(true);
    });
  });
});
