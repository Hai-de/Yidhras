import { describe, expect, it } from 'vitest';

import { PackManifestLoader } from '../../../src/packs/manifest/loader.js';

describe('snowbound_mansion world pack', () => {
  it('loads and passes schema validation', () => {
    const loader = new PackManifestLoader('/home/aimana/文档/AI-related/Yidhras/data/world_packs');
    const pack = loader.loadPack('snowbound_mansion');

    expect(pack.metadata.id).toBe('snowbound_mansion');
    expect(pack.metadata.name).toBe('暴风雪山庄');
    expect(pack.entities?.domains?.length).toBe(15);
    expect(pack.entities?.actors?.length).toBe(12);

    const spatial = pack.spatial;
    expect(spatial).toBeDefined();
    if (!spatial) return;
    expect(spatial.model).toBe('discrete');
    expect(spatial.locations.length).toBe(15);
    expect(spatial.edges.length).toBeGreaterThan(0);

    expect(pack.identities?.length).toBe(12);
    expect(pack.bootstrap?.initial_states?.length).toBeGreaterThan(0);
  });
});
