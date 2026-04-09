import { describe, expect, it } from 'vitest';

import { createContextOverlayStore } from '../../src/context/overlay/store.js';
import { buildContextNodesFromOverlayEntries } from '../../src/context/sources/overlay.js';
import { createIsolatedAppContextFixture } from '../fixtures/isolated-db.js';

describe('context overlay store', () => {
  it('persists overlay entries and materializes them into writable overlay nodes', async () => {
    const fixture = await createIsolatedAppContextFixture();

    try {
      const store = createContextOverlayStore(fixture.context);
      const created = await store.createEntry({
        actor_id: 'agent-001',
        pack_id: 'world-death-note',
        overlay_type: 'self_note',
        title: 'Notebook plan',
        content_text: 'Confirm target face before writing the name.',
        content_structured: {
          confidence: 0.9,
          target_candidate_id: 'candidate-l'
        },
        tags: ['plan', 'death-note'],
        persistence_mode: 'sticky',
        source_node_ids: ['trace-1', 'summary-1'],
        created_by: 'system',
        created_at_tick: '1000'
      });

      expect(created.actor_id).toBe('agent-001');
      expect(created.overlay_type).toBe('self_note');
      expect(created.persistence_mode).toBe('sticky');
      expect(created.source_node_ids).toEqual(['trace-1', 'summary-1']);

      const listed = await store.listEntries({
        actor_id: 'agent-001',
        pack_id: 'world-death-note',
        statuses: ['active']
      });

      expect(listed).toHaveLength(1);
      expect(listed[0]?.content_structured).toEqual({
        confidence: 0.9,
        target_candidate_id: 'candidate-l'
      });
      expect(listed[0]?.tags).toEqual(['plan', 'death-note']);

      const nodes = buildContextNodesFromOverlayEntries(listed);
      expect(nodes).toHaveLength(1);
      expect(nodes[0]?.source_kind).toBe('overlay');
      expect(nodes[0]?.visibility.level).toBe('writable_overlay');
      expect(nodes[0]?.mutability.level).toBe('overlay');
      expect(nodes[0]?.placement_policy.preferred_slot).toBe('memory_short_term');
      expect(nodes[0]?.content.text).toContain('Notebook plan');
      expect(nodes[0]?.metadata?.overlay_type).toBe('self_note');
    } finally {
      await fixture.cleanup();
    }
  });
});
