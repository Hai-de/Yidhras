import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';
import * as YAML from 'yaml';

import { applyOpening } from '../../src/packs/openings/applicator.js';
import { listPackOpenings, type OpeningSummary } from '../../src/packs/openings/discovery.js';
import { loadPackOpening } from '../../src/packs/openings/loader.js';
import { parseWorldPackConstitution } from '../../src/packs/schema/constitution_schema.js';

const FIXTURES_DIR = path.resolve('tests/fixtures/packs/opening-test-pack');

describe('pack opening integration', () => {
  describe('listPackOpenings', () => {
    it('lists openings from fixture pack', () => {
      const openings = listPackOpenings(FIXTURES_DIR);
      expect(openings.length).toBeGreaterThanOrEqual(1);
      const ids = openings.map((o: OpeningSummary) => o.id);
      expect(ids).toContain('default');
      expect(ids).toContain('alternate');
    });

    it('returns metadata for openings', () => {
      const openings = listPackOpenings(FIXTURES_DIR);
      const defaultOpening = openings.find((o: OpeningSummary) => o.id === 'default');
      expect(defaultOpening?.name).toBe('Default Opening');
    });

    it('returns empty array for non-existent pack dir', () => {
      const openings = listPackOpenings('/nonexistent/path/xyz');
      expect(openings).toEqual([]);
    });
  });

  describe('loadPackOpening', () => {
    it('loads and validates an opening file', () => {
      const opening = loadPackOpening(FIXTURES_DIR, 'default');
      expect(opening.name).toBe('Default Opening');
      expect(opening.variables).toEqual({ difficulty: 'easy' });
      expect(opening.initial_states).toHaveLength(1);
    });

    it('loads opening with initial_events', () => {
      const opening = loadPackOpening(FIXTURES_DIR, 'alternate');
      expect(opening.initial_events).toHaveLength(1);
      expect(opening.initial_events?.[0]?.event_type).toBe('world_opening');
    });

    it('throws on non-existent opening', () => {
      expect(() => loadPackOpening(FIXTURES_DIR, 'nonexistent')).toThrow('not found');
    });
  });

  describe('applyOpening integration with fixture pack', () => {
    it('produces valid merged constitution', () => {
      const packContent = fs.readFileSync(path.join(FIXTURES_DIR, 'config.yaml'), 'utf-8');
      const pack = parseWorldPackConstitution(YAML.parse(packContent));

      const opening = loadPackOpening(FIXTURES_DIR, 'alternate');
      const merged = applyOpening(pack, opening);

      expect(merged.variables).toEqual({
        difficulty: 'hard',
        starting_trust: 30,
        world_tone: 'hostile'
      });
      expect(merged.bootstrap?.initial_states).toHaveLength(1);
      expect(merged.bootstrap?.initial_states?.[0]?.state_json).toMatchObject({
        phase: 'alternate_opening',
        threat_level: 'high'
      });
      expect(merged.bootstrap?.initial_events).toHaveLength(1);
    });
  });
});
