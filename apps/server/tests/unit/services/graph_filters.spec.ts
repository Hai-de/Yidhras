import { describe, expect, it } from 'vitest';

import {
  normalizeSearch,
  parseGraphDepth,
  parseGraphKinds,
  parseGraphView,
  parseGraphViewFilters
} from '../../../src/app/services/relational/graph_filters.js';

describe('graph_filters', () => {
  describe('parseGraphView', () => {
    it('returns tree for "tree"', () => {
      expect(parseGraphView('tree')).toBe('tree');
    });

    it('returns mesh for "mesh"', () => {
      expect(parseGraphView('mesh')).toBe('mesh');
    });

    it('returns mesh for undefined', () => {
      expect(parseGraphView(undefined)).toBe('mesh');
    });

    it('returns mesh for any other string', () => {
      expect(parseGraphView('grid')).toBe('mesh');
      expect(parseGraphView('')).toBe('mesh');
    });
  });

  describe('parseGraphDepth', () => {
    it('returns DEFAULT_GRAPH_DEPTH (1) for undefined', () => {
      expect(parseGraphDepth(undefined)).toBe(1);
    });

    it('returns DEFAULT_GRAPH_DEPTH for non-finite numbers', () => {
      expect(parseGraphDepth(Number.NaN)).toBe(1);
      expect(parseGraphDepth(Number.POSITIVE_INFINITY)).toBe(1);
    });

    it('clamps to 0 minimum', () => {
      expect(parseGraphDepth(-5)).toBe(0);
    });

    it('clamps to MAX_GRAPH_DEPTH (3) maximum', () => {
      expect(parseGraphDepth(100)).toBe(3);
    });

    it('truncates fractional values', () => {
      expect(parseGraphDepth(2.7)).toBe(2);
      expect(parseGraphDepth(0.9)).toBe(0);
    });

    it('passes through valid integers within range', () => {
      expect(parseGraphDepth(0)).toBe(0);
      expect(parseGraphDepth(1)).toBe(1);
      expect(parseGraphDepth(2)).toBe(2);
      expect(parseGraphDepth(3)).toBe(3);
    });
  });

  describe('parseGraphKinds', () => {
    it('returns null for undefined', () => {
      expect(parseGraphKinds(undefined)).toBeNull();
    });

    it('returns null for empty array', () => {
      expect(parseGraphKinds([])).toBeNull();
    });

    it('returns null for array of empty strings', () => {
      expect(parseGraphKinds(['', '  '])).toBeNull();
    });

    it('parses valid kinds', () => {
      expect(parseGraphKinds(['agent', 'atmosphere'])).toEqual(['agent', 'atmosphere']);
    });

    it('deduplicates kinds', () => {
      expect(parseGraphKinds(['agent', 'agent', 'atmosphere'])).toEqual(['agent', 'atmosphere']);
    });

    it('trims whitespace', () => {
      expect(parseGraphKinds(['  agent  ', ' atmosphere '])).toEqual(['agent', 'atmosphere']);
    });

    it('filters empty strings after trim', () => {
      expect(parseGraphKinds(['agent', '', '  ', 'atmosphere'])).toEqual(['agent', 'atmosphere']);
    });

    it('throws ApiError for invalid kinds', () => {
      expect(() => parseGraphKinds(['agent', 'invalid_kind'])).toThrow(
        /kinds contains unsupported graph node kind/
      );
    });
  });

  describe('normalizeSearch', () => {
    it('returns null for undefined', () => {
      expect(normalizeSearch(undefined)).toBeNull();
    });

    it('returns null for empty string', () => {
      expect(normalizeSearch('')).toBeNull();
    });

    it('returns null for whitespace only', () => {
      expect(normalizeSearch('   ')).toBeNull();
    });

    it('normalizes to lowercase and trims', () => {
      expect(normalizeSearch('  Alice  ')).toBe('alice');
    });

    it('preserves already normalized input', () => {
      expect(normalizeSearch('bob')).toBe('bob');
    });
  });

  describe('parseGraphViewFilters', () => {
    it('returns full defaults for empty input', () => {
      const result = parseGraphViewFilters({});
      expect(result).toEqual({
        view: 'mesh',
        depth: 1,
        kinds: null,
        rootId: null,
        search: null,
        includeInactive: false,
        includeUnresolved: true
      });
    });

    it('passes through all provided values', () => {
      const result = parseGraphViewFilters({
        view: 'tree',
        depth: 2,
        kinds: ['agent'],
        root_id: 'root-1',
        search: 'test',
        include_inactive: true,
        include_unresolved: false
      });

      expect(result).toEqual({
        view: 'tree',
        depth: 2,
        kinds: ['agent'],
        rootId: 'root-1',
        search: 'test',
        includeInactive: true,
        includeUnresolved: false
      });
    });

    it('treats empty root_id as null', () => {
      const result = parseGraphViewFilters({ root_id: '  ' });
      expect(result.rootId).toBeNull();
    });

    it('defaults includeUnresolved to true when not specified', () => {
      const result = parseGraphViewFilters({});
      expect(result.includeUnresolved).toBe(true);
    });

    it('defaults includeInactive to false when not specified', () => {
      const result = parseGraphViewFilters({});
      expect(result.includeInactive).toBe(false);
    });
  });
});
