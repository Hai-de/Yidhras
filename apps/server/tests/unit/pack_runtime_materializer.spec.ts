import fs from 'fs';

import { afterEach, describe, expect, it } from 'vitest';

import { resetRuntimeConfigCache } from '../../src/config/runtime_config.js';
import { installPackRuntime } from '../../src/kernel/install/install_pack.js';
import { parseWorldPackConstitution } from '../../src/packs/manifest/constitution_loader.js';
import { materializePackRuntimeCoreModels } from '../../src/packs/runtime/materializer.js';
import { listPackAuthorityGrants } from '../../src/packs/storage/authority_repo.js';
import { listPackEntityStates } from '../../src/packs/storage/entity_state_repo.js';
import { listPackMediatorBindings } from '../../src/packs/storage/mediator_repo.js';
import { listPackWorldEntities } from '../../src/packs/storage/entity_repo.js';
import { createIsolatedRuntimeEnvironment } from '../helpers/runtime.js';

const createdRoots: string[] = [];

afterEach(() => {
  resetRuntimeConfigCache();
  delete process.env.WORKSPACE_ROOT;
  for (const root of createdRoots.splice(0, createdRoots.length)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe('pack runtime materializer', () => {
  it('materializes world entities, entity states, authorities, mediator bindings, and bootstrap state into the pack db', async () => {
    const environment = await createIsolatedRuntimeEnvironment({ appEnv: 'test' });
    createdRoots.push(environment.rootDir);
    process.env.WORKSPACE_ROOT = environment.rootDir;

    const pack = parseWorldPackConstitution({
      metadata: {
        id: 'world-test-pack',
        name: '测试世界',
        version: '1.0.0'
      },
      entities: {
        actors: [
          {
            id: 'actor-light',
            label: '夜神月',
            kind: 'actor',
            state: {
              knows_notebook_power: false
            }
          }
        ],
        artifacts: [
          {
            id: 'artifact-death-note',
            label: '死亡笔记',
            kind: 'artifact',
            entity_type: 'death_note',
            state: {
              holder_agent_id: null
            }
          }
        ],
        mediators: [
          {
            id: 'mediator-death-note',
            entity_ref: 'artifact-death-note',
            mediator_kind: 'artifact_vessel',
            grants: [{ capability_key: 'invoke.death_rule' }]
          }
        ],
        domains: [],
        institutions: []
      },
      identities: [
        {
          id: 'identity-light-human',
          subject_entity_id: 'actor-light',
          type: 'mortal'
        }
      ],
      capabilities: [
        {
          key: 'invoke.death_rule',
          category: 'invoke',
          target_schema: 'actor'
        }
      ],
      authorities: [
        {
          id: 'authority-death-note-holder',
          source_entity_id: 'mediator-death-note',
          target_selector: {
            kind: 'holder_of',
            entity_id: 'artifact-death-note'
          },
          capability_key: 'invoke.death_rule',
          grant_type: 'mediated',
          priority: 100
        }
      ],
      bootstrap: {
        initial_states: [
          {
            entity_id: '__world__',
            state_namespace: 'world',
            state_json: {
              opening_phase: 'notebook_unclaimed'
            }
          }
        ],
        initial_events: []
      }
    });

    await installPackRuntime(pack);
    const summary = await materializePackRuntimeCoreModels(pack, 1000n);

    expect(summary.pack_id).toBe('world-test-pack');
    expect(summary.world_entity_count).toBeGreaterThanOrEqual(4);
    expect(summary.entity_state_count).toBeGreaterThanOrEqual(2);
    expect(summary.authority_grant_count).toBe(1);
    expect(summary.mediator_binding_count).toBe(1);

    const worldEntities = await listPackWorldEntities('world-test-pack');
    const entityStates = await listPackEntityStates('world-test-pack');
    const authorityGrants = await listPackAuthorityGrants('world-test-pack');
    const mediatorBindings = await listPackMediatorBindings('world-test-pack');

    expect(worldEntities.some(item => item.label === '夜神月')).toBe(true);
    expect(worldEntities.some(item => item.entity_kind === 'mediator')).toBe(true);
    expect(worldEntities.some(item => item.id === 'world-test-pack:entity:__world__')).toBe(true);
    expect(entityStates.some(item => item.entity_id === 'actor-light' && item.state_namespace === 'core')).toBe(true);
    expect(entityStates.some(item => item.entity_id === '__world__' && item.state_namespace === 'world')).toBe(true);
    expect(authorityGrants[0]?.capability_key).toBe('invoke.death_rule');
    expect(mediatorBindings[0]?.subject_entity_id).toBe('artifact-death-note');
  });
});
