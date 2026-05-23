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
        collectives: [
          {
            id: 'collective-taskforce-observers',
            label: '对策本部观察者群体',
            kind: 'collective',
            entity_type: 'observer_group',
            state: {
              shared_reputation: 10,
              member_count: 2
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

    await installPackRuntime(pack.metadata.id, pack, packStorageAdapter);
    const summary = await materializePackRuntimeCoreModels(pack.metadata.id, pack, 1000n, packStorageAdapter);

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
    expect(worldEntities.some(item => item.id === 'world-test-pack:entity:collective-taskforce-observers' && item.entity_kind === 'collective')).toBe(true);
    expect(entityStates.some(item => item.entity_id === 'actor-light' && item.state_namespace === 'core')).toBe(true);
    expect(entityStates.some(item => item.entity_id === '__world__' && item.state_namespace === 'world')).toBe(true);
    expect(entityStates.some(item => item.entity_id === 'domain-investigation' && item.state_namespace === 'domain')).toBe(true);
    expect(entityStates.some(item => item.entity_id === 'institution-npa-taskforce' && item.state_namespace === 'core')).toBe(true);
    expect(entityStates.some(item => item.entity_id === 'collective-taskforce-observers' && item.state_namespace === 'core')).toBe(true);
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

    const summary = await installPackRuntime(pack.metadata.id, pack, packStorageAdapter);
    expect(summary.packCollections).toEqual(['target_dossiers', 'judgement_plans']);
  });

  it('expands pick macros with pack.variables.* references in entity state during materialization', async () => {
    const environment = await createIsolatedRuntimeEnvironment({ appEnv: 'test' });
    createdRoots.push(environment.rootDir);
    process.env.WORKSPACE_ROOT = environment.rootDir;

    const pack = parseWorldPackConstitution({
      metadata: {
        id: 'world-macro-ref-pack',
        name: '宏变量引用测试',
        version: '1.0.0'
      },
      variables: {
        names: ['张三', '李四', '王五'],
        traits: ['勇敢', '谨慎', '狡猾']
      },
      entities: {
        actors: [
          {
            id: 'actor-alpha',
            label: '角色A',
            kind: 'actor',
            state: {
              name: '{{pick from=pack.variables.names}}',
              trait: '{{pick from=pack.variables.traits}}'
            }
          }
        ]
      }
    });

    await installPackRuntime(pack.metadata.id, pack, packStorageAdapter);
    await materializePackRuntimeCoreModels(pack.metadata.id, pack, 2000n, packStorageAdapter);

    const entityStates = await listPackEntityStates(packStorageAdapter, 'world-macro-ref-pack');
    const actorState = entityStates.find(
      (item) => item.entity_id === 'actor-alpha' && item.state_namespace === 'core'
    );

    expect(actorState).toBeDefined();
    const stateJson = actorState!.state_json as Record<string, unknown>;
    const name = String(stateJson.name);
    const trait = String(stateJson.trait);

    // Should NOT contain raw template strings
    expect(name).not.toContain('{{pick');
    expect(name).not.toContain('pack.variables');
    expect(trait).not.toContain('{{pick');
    expect(trait).not.toContain('pack.variables');

    // Should be one of the values from the variable pools
    expect(['张三', '李四', '王五']).toContain(name);
    expect(['勇敢', '谨慎', '狡猾']).toContain(trait);
  });

  it('expands pick macros in bootstrap state using pack.variables.* references', async () => {
    const environment = await createIsolatedRuntimeEnvironment({ appEnv: 'test' });
    createdRoots.push(environment.rootDir);
    process.env.WORKSPACE_ROOT = environment.rootDir;

    const pack = parseWorldPackConstitution({
      metadata: {
        id: 'world-bootstrap-ref-pack',
        name: 'Bootstrap变量引用测试',
        version: '1.0.0'
      },
      variables: {
        scenarios: ['暴风雪', '浓雾'],
        locations: ['别墅', '古堡']
      },
      entities: {
        actors: [
          {
            id: 'actor-beta',
            label: '角色B',
            kind: 'actor',
            state: { alive: true }
          }
        ]
      },
      bootstrap: {
        initial_states: [
          {
            entity_id: '__world__',
            state_namespace: 'world',
            state_json: {
              scenario: '{{pick from=pack.variables.scenarios}}导致被困',
              location_type: '{{pick from=pack.variables.locations}}'
            }
          }
        ],
        initial_events: []
      }
    });

    await installPackRuntime(pack.metadata.id, pack, packStorageAdapter);
    await materializePackRuntimeCoreModels(pack.metadata.id, pack, 3000n, packStorageAdapter);

    const entityStates = await listPackEntityStates(packStorageAdapter, 'world-bootstrap-ref-pack');
    const worldState = entityStates.find(
      (item) => item.entity_id === '__world__' && item.state_namespace === 'world'
    );

    expect(worldState).toBeDefined();
    const stateJson = worldState!.state_json as Record<string, unknown>;
    const scenario = String(stateJson.scenario);
    const locationType = String(stateJson.location_type);

    // Should NOT contain raw template strings
    expect(scenario).not.toContain('{{pick');
    expect(scenario).not.toContain('pack.variables');
    expect(locationType).not.toContain('{{pick');
    expect(locationType).not.toContain('pack.variables');

    // Should have resolved values (scenario ends with 导致被困 after the pick result)
    expect(scenario).toMatch(/^(暴风雪|浓雾)导致被困$/);
    expect(['别墅', '古堡']).toContain(locationType);
  });
});
