import { describe, expect, it } from 'vitest';

import type { StepContributor } from '../../src/app/runtime/world_engine_contributors.js';
import { pluginRuntimeRegistry } from '../../src/plugins/runtime.js';

describe('world engine plugin contributor chain', () => {
  it('registers plugin step contributors in the runtime registry', async () => {
    const packId = 'test-contributor-pack';

    const mockContributor: StepContributor = {
      name: 'mock_plugin_step',
      priority: 10,
      contributePrepare() {
        return {
          delta_operations: [
            {
              op: 'custom',
              target_ref: 'mock-target',
              namespace: 'mock-ns',
              payload: { injected: true }
            }
          ],
          emitted_events: [],
          observability: []
        };
      }
    };

    pluginRuntimeRegistry.setRuntimes(packId, [
      {
        installation_id: 'install-1',
        plugin_id: 'mock-plugin',
        pack_id: packId,
        manifest: {
          manifest_version: 'plugin/v1',
          id: 'mock-plugin',
          name: 'Mock Plugin',
          version: '1.0.0',
          kind: 'extension',
          entrypoints: { server: { runtime: 'node_esm' } },
          compatibility: { yidhras: '0.1.0', pack_id: packId },
          requested_capabilities: [],
          contributions: {
            server: {
              context_sources: [],
              prompt_workflow_steps: [],
              intent_grounders: [],
              pack_projections: [],
              api_routes: [],
              step_contributors: ['mock_plugin_step'],
              rule_contributors: [],
              query_contributors: []
            },
            web: { panels: [], routes: [], menu_items: [] }
          }
        } as never,
        granted_capabilities: ['server.step_contributor.register'],
        context_sources: [],
        prompt_workflow_steps: [],
        pack_routes: [],
        step_contributors: [mockContributor],
        rule_contributors: [],
        query_contributors: []
      }
    ]);

    const contributors = pluginRuntimeRegistry.getStepContributors(packId);
    expect(contributors).toHaveLength(1);
    expect(contributors[0]?.name).toBe('mock_plugin_step');
    expect(contributors[0]?.priority).toBe(10);

    pluginRuntimeRegistry.clearRuntimes(packId);
  });
});
