import fs from 'fs';

import { afterEach, describe, expect, it } from 'vitest';

import { resetRuntimeConfigCache } from '../../src/config/runtime_config.js';
import { installPackRuntime } from '../../src/kernel/install/install_pack.js';
import { parseWorldPackConstitution } from '../../src/packs/manifest/constitution_loader.js';
import { materializePackRuntimeCoreModels } from '../../src/packs/runtime/materializer.js';
import { SqlitePackStorageAdapter } from '../../src/packs/storage/internal/SqlitePackStorageAdapter.js';
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
  const packStorageAdapter = new SqlitePackStorageAdapter();

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
        domains: [
          {
            id: 'domain-investigation',
            label: '调查域',
            kind: 'domain',
            state: {
              visibility: 'restricted'
            }
          }
        ],
        institutions: [
          {
            id: 'institution-npa-taskforce',
            label: '基拉对策本部',
            kind: 'institution',
            state: {
              alert_stage: 'routine',
              coordination_level: 0
            }
          },
          {
            id: 'institution-public-media',
            label: '公共媒体系统',
            kind: 'institution',
            state: {
              amplification_level: 0
            }
          }
        ]
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
      rules: {
        invocation: [
          {
            id: 'invocation-collect-intel',
            when: {
              'semantic_intent.kind': 'gather_target_intel'
            },
            then: {
              affordance_key: 'gather_target_intel',
              requires_capability: 'invoke.death_rule',
              resolution_mode: 'exact'
            }
          }
        ]
      },
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

    await installPackRuntime(pack, packStorageAdapter);
    const summary = await materializePackRuntimeCoreModels(pack, 1000n, packStorageAdapter);

    expect(summary.pack_id).toBe('world-test-pack');
    expect(summary.world_entity_count).toBeGreaterThanOrEqual(4);
    expect(summary.entity_state_count).toBeGreaterThanOrEqual(2);
    expect(summary.authority_grant_count).toBe(1);
    expect(summary.mediator_binding_count).toBe(1);

    const worldEntities = await listPackWorldEntities(packStorageAdapter, 'world-test-pack');
    const entityStates = await listPackEntityStates(packStorageAdapter, 'world-test-pack');
    const authorityGrants = await listPackAuthorityGrants(packStorageAdapter, 'world-test-pack');
    const mediatorBindings = await listPackMediatorBindings(packStorageAdapter, 'world-test-pack');

    expect(worldEntities.some(item => item.label === '夜神月')).toBe(true);
    expect(worldEntities.some(item => item.entity_kind === 'mediator')).toBe(true);
    expect(worldEntities.some(item => item.id === 'world-test-pack:entity:__world__')).toBe(true);
    expect(worldEntities.some(item => item.id === 'world-test-pack:entity:identity-light-human')).toBe(true);
    expect(worldEntities.some(item => item.id === 'world-test-pack:entity:domain-investigation' && item.entity_kind === 'domain')).toBe(true);
    expect(worldEntities.some(item => item.id === 'world-test-pack:entity:institution-npa-taskforce' && item.entity_kind === 'institution')).toBe(true);
    expect(worldEntities.some(item => item.id === 'world-test-pack:entity:institution-public-media' && item.entity_kind === 'institution')).toBe(true);
    expect(entityStates.some(item => item.entity_id === 'actor-light' && item.state_namespace === 'core')).toBe(true);
    expect(entityStates.some(item => item.entity_id === '__world__' && item.state_namespace === 'world')).toBe(true);
    expect(entityStates.some(item => item.entity_id === 'domain-investigation' && item.state_namespace === 'domain')).toBe(true);
    expect(entityStates.some(item => item.entity_id === 'institution-npa-taskforce' && item.state_namespace === 'core')).toBe(true);
    expect(authorityGrants[0]?.capability_key).toBe('invoke.death_rule');
    expect(mediatorBindings[0]?.subject_entity_id).toBe('artifact-death-note');
  });

  it('keeps declared pack storage collections when materializing install metadata for death note style models', async () => {
    const environment = await createIsolatedRuntimeEnvironment({ appEnv: 'test' });
    createdRoots.push(environment.rootDir);
    process.env.WORKSPACE_ROOT = environment.rootDir;

    const pack = parseWorldPackConstitution({
      metadata: {
        id: 'world-storage-pack',
        name: '存储测试世界',
        version: '1.0.0'
      },
      storage: {
        strategy: 'isolated_pack_db',
        runtime_db_file: 'runtime.sqlite',
        pack_collections: [
          {
            key: 'target_dossiers',
            kind: 'table',
            primary_key: 'id',
            fields: [
              { key: 'id', type: 'string', required: true },
              { key: 'owner_actor_id', type: 'entity_ref', required: true },
              { key: 'target_entity_id', type: 'entity_ref', required: true },
              { key: 'content', type: 'json', required: true }
            ],
            indexes: [['owner_actor_id', 'target_entity_id']]
          },
          {
            key: 'judgement_plans',
            kind: 'table',
            primary_key: 'id',
            fields: [
              { key: 'id', type: 'string', required: true },
              { key: 'owner_actor_id', type: 'entity_ref', required: true },
              { key: 'phase', type: 'string' },
              { key: 'content', type: 'json', required: true }
            ],
            indexes: [['owner_actor_id', 'phase']]
          }
        ],
        install: {
          compile_on_activate: true,
          allow_pack_collections: true,
          allow_raw_sql: false
        }
      }
    });

    const summary = await installPackRuntime(pack, packStorageAdapter);
    expect(summary.packCollections).toEqual(['target_dossiers', 'judgement_plans']);
  });
});
