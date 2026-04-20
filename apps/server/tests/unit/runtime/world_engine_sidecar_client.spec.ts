import { WORLD_ENGINE_PROTOCOL_VERSION } from '@yidhras/contracts';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  WorldEngineSidecarClient,
  type WorldEngineSidecarTransport
} from '../../../src/app/runtime/sidecar/world_engine_sidecar_client.js';

class InMemoryStubTransport implements WorldEngineSidecarTransport {
  private started = false;
  private sessions = new Map<string, { mode: string; tick: string; revision: string; pending: string | null }>();

  async start(): Promise<void> {
    this.started = true;
  }

  async stop(): Promise<void> {
    this.started = false;
    this.sessions.clear();
  }

  async send<T>(method: string, params: Record<string, unknown>, parse: (value: unknown) => T): Promise<T> {
    if (!this.started) {
      throw new Error('transport not started');
    }

    switch (method) {
      case 'world.protocol.handshake':
        return parse({
          protocol_version: WORLD_ENGINE_PROTOCOL_VERSION,
          accepted: true,
          transport: 'stdio_jsonrpc',
          engine_instance_id: 'in-memory-stub',
          supported_methods: [
            'world.protocol.handshake',
            'world.health.get',
            'world.pack.load',
            'world.pack.unload',
            'world.state.query',
            'world.rule.execute_objective',
            'world.status.get',
            'world.step.prepare',
            'world.step.commit',
            'world.step.abort'
          ],
          engine_capabilities: ['stub']
        });
      case 'world.health.get':
        return parse({
          protocol_version: WORLD_ENGINE_PROTOCOL_VERSION,
          transport: 'stdio_jsonrpc',
          engine_status: 'ready',
          engine_instance_id: 'in-memory-stub',
          uptime_ms: 1,
          loaded_pack_ids: Array.from(this.sessions.keys()),
          tainted_pack_ids: [],
          last_error_code: null,
          message: 'In-memory stub'
        });
      case 'world.pack.load': {
        const packId = String(params.pack_id);
        this.sessions.set(packId, {
          mode: String(params.mode ?? 'active'),
          tick: '0',
          revision: '0',
          pending: null
        });
        return parse({
          protocol_version: WORLD_ENGINE_PROTOCOL_VERSION,
          pack_id: packId,
          mode: String(params.mode ?? 'active'),
          session_status: 'ready',
          hydrated_from_persistence: true,
          current_tick: '0',
          current_revision: '0'
        });
      }
      case 'world.status.get': {
        const packId = String(params.pack_id);
        const session = this.sessions.get(packId);
        return parse({
          protocol_version: WORLD_ENGINE_PROTOCOL_VERSION,
          pack_id: packId,
          mode: session?.mode ?? 'experimental',
          session_status: session ? 'ready' : 'not_loaded',
          runtime_ready: Boolean(session),
          current_tick: session?.tick ?? null,
          current_revision: session?.revision ?? null,
          pending_prepared_token: session?.pending ?? null,
          message: session ? null : 'Pack session is not loaded'
        });
      }
      case 'world.state.query':
        return parse({
          protocol_version: WORLD_ENGINE_PROTOCOL_VERSION,
          pack_id: String(params.pack_id),
          query_name: params.query_name,
          current_tick: '0',
          current_revision: '0',
          data: {
            summary: {
              pack_id: String(params.pack_id),
              transport: 'in-memory-stub'
            }
          },
          next_cursor: null,
          warnings: []
        });
      case 'world.rule.execute_objective':
        return parse({
          protocol_version: WORLD_ENGINE_PROTOCOL_VERSION,
          pack_id: String(params.pack_id),
          rule_id: 'stub-objective-rule',
          capability_key: 'invoke.claim_book',
          mediator_id: null,
          target_entity_id: 'artifact-book',
          bridge_mode: 'objective_rule',
          mutations: [
            {
              entity_id: 'artifact-book',
              state_namespace: 'core',
              state_patch: {
                holder_agent_id: 'agent-holder'
              }
            }
          ],
          emitted_events: [],
          diagnostics: {
            matched_rule_id: 'stub-objective-rule',
            no_match_reason: null,
            evaluated_rule_count: 1,
            rendered_template_count: 1,
            mutation_count: 1,
            emitted_event_count: 0
          }
        });
      case 'world.step.prepare': {
        const packId = String(params.pack_id);
        const stepTicks = BigInt(String(params.step_ticks));
        const session = this.sessions.get(packId)!;
        const nextTick = (BigInt(session.tick) + stepTicks).toString();
        const token = `prepared:${packId}:${nextTick}`;
        session.pending = token;
        return parse({
          prepared_token: token,
          pack_id: packId,
          base_revision: session.revision,
          next_revision: nextTick,
          next_tick: nextTick,
          state_delta: {
            operations: [
              {
                op: 'upsert_entity_state',
                target_ref: '__world__',
                namespace: 'world',
                payload: {
                  next: {
                    runtime_step: {
                      prepared_token: token,
                      transition_kind: 'clock_advance'
                    }
                  },
                  previous: {},
                  reason: String(params.reason ?? 'manual')
                }
              },
              {
                op: 'append_rule_execution',
                target_ref: '__world__',
                namespace: 'rule_execution_records',
                payload: {
                  next: {
                    id: `world-step:${token}`,
                    payload_json: {
                      prepared_token: token,
                      transition_kind: 'clock_advance'
                    }
                  },
                  reason: String(params.reason ?? 'manual')
                }
              },
              {
                op: 'set_clock',
                payload: {
                  next: {
                    previous_tick: session.tick,
                    next_tick: nextTick,
                    previous_revision: session.revision,
                    next_revision: nextTick
                  },
                  reason: String(params.reason ?? 'manual')
                }
              }
            ],
            metadata: {
              pack_id: packId,
              adapter: 'in-memory-stub',
              reason: String(params.reason ?? 'manual'),
              base_tick: session.tick,
              next_tick: nextTick,
              base_revision: session.revision,
              next_revision: nextTick,
              mutated_entity_ids: ['__world__'],
              mutated_namespace_refs: ['__world__/world', 'rule_execution_records'],
              delta_operation_count: 3
            }
          },
          emitted_events: [
            {
              event_id: `world-step-prepared:${token}`,
              pack_id: packId,
              event_type: 'world.step.prepared',
              emitted_at_tick: nextTick,
              emitted_at_revision: nextTick,
              entity_id: '__world__',
              refs: {
                prepared_token: token,
                reason: String(params.reason ?? 'manual'),
                entity_id: '__world__'
              },
              payload: {
                transition_kind: 'clock_advance',
                reason: String(params.reason ?? 'manual'),
                affected_entity_ids: ['__world__']
              }
            }
          ],
          observability: [
            {
              kind: 'diagnostic',
              level: 'info',
              code: 'WORLD_STEP_PREPARED',
              attributes: { affected_entity_ids: ['__world__'], emitted_event_count: 1 }
            },
            {
              kind: 'diagnostic',
              level: 'info',
              code: 'WORLD_CORE_DELTA_BUILT',
              attributes: {
                delta_operation_count: 3,
                mutated_entity_ids: ['__world__'],
                mutated_namespace_refs: ['__world__/world', 'rule_execution_records'],
                mutated_core_collections: ['entity_states', 'rule_execution_records']
              }
            }
          ],
          summary: {
            applied_rule_count: 0,
            event_count: 0,
            mutated_entity_count: 2
          }
        });
      }
      case 'world.step.commit': {
        const packId = String(params.pack_id);
        const session = this.sessions.get(packId)!;
        session.pending = null;
        session.tick = String(params.persisted_revision);
        session.revision = String(params.persisted_revision);
        return parse({
          protocol_version: WORLD_ENGINE_PROTOCOL_VERSION,
          pack_id: packId,
          prepared_token: String(params.prepared_token),
          committed_revision: session.revision,
          committed_tick: session.tick,
          summary: {
            applied_rule_count: 0,
            event_count: 0,
            mutated_entity_count: 2
          }
        });
      }
      case 'world.step.abort': {
        const packId = String(params.pack_id);
        const session = this.sessions.get(packId);
        if (session) {
          session.pending = null;
        }
        return parse({
          protocol_version: WORLD_ENGINE_PROTOCOL_VERSION,
          acknowledged: true,
          pack_id: packId,
          message: 'aborted'
        });
      }
      case 'world.pack.unload': {
        const packId = String(params.pack_id);
        this.sessions.delete(packId);
        return parse({
          protocol_version: WORLD_ENGINE_PROTOCOL_VERSION,
          acknowledged: true,
          pack_id: packId,
          message: 'unloaded'
        });
      }
      default:
        throw new Error(`unsupported method: ${method}`);
    }
  }
}

describe('WorldEngineSidecarClient', () => {
  let client: WorldEngineSidecarClient;

  beforeEach(async () => {
    client = new WorldEngineSidecarClient(new InMemoryStubTransport());
    await client.stop();
  });

  it('performs handshake and health check through the sidecar transport contract', async () => {
    const health = await client.getHealth();

    expect(health.protocol_version).toBe(WORLD_ENGINE_PROTOCOL_VERSION);
    expect(health.transport).toBe('stdio_jsonrpc');
    expect(health.engine_status).toBe('ready');
    expect(health.engine_instance_id).toBe('in-memory-stub');

    await client.stop();
  });

  it('supports load/query/prepare/commit/abort roundtrip', async () => {
    const load = await client.loadPack({
      pack_id: 'world-death-note',
      mode: 'active'
    });
    expect(load.pack_id).toBe('world-death-note');
    expect(load.session_status).toBe('ready');

    const status = await client.getStatus({ pack_id: 'world-death-note' });
    expect(status.runtime_ready).toBe(true);

    const query = await client.queryState({
      protocol_version: WORLD_ENGINE_PROTOCOL_VERSION,
      pack_id: 'world-death-note',
      query_name: 'pack_summary',
      selector: {}
    });
    expect(query.pack_id).toBe('world-death-note');

    const prepared = await client.prepareStep({
      protocol_version: WORLD_ENGINE_PROTOCOL_VERSION,
      pack_id: 'world-death-note',
      step_ticks: '1',
      reason: 'manual'
    });
    expect(prepared.pack_id).toBe('world-death-note');
    expect(prepared.next_tick).toBe('1');
    expect(prepared.state_delta.operations).toHaveLength(3);
    expect(prepared.emitted_events).toHaveLength(1);
    expect(prepared.emitted_events[0]).toMatchObject({
      event_type: 'world.step.prepared',
      entity_id: '__world__'
    });
    expect(prepared.observability).toHaveLength(2);
    expect(prepared.state_delta.metadata).toMatchObject({
      pack_id: 'world-death-note',
      reason: 'manual',
      mutated_entity_ids: ['__world__'],
      mutated_namespace_refs: ['__world__/world', 'rule_execution_records'],
      delta_operation_count: 3
    });
    expect(prepared.state_delta.operations[1]).toMatchObject({
      op: 'append_rule_execution',
      namespace: 'rule_execution_records'
    });
    expect(prepared.observability.map(item => item.code)).toContain('WORLD_STEP_PREPARED');
    expect(prepared.observability.map(item => item.code)).toContain('WORLD_CORE_DELTA_BUILT');
    expect(prepared.observability[0]?.code).toBe('WORLD_STEP_PREPARED');
    expect(prepared.summary.mutated_entity_count).toBe(2);

    const committed = await client.commitPreparedStep({
      protocol_version: WORLD_ENGINE_PROTOCOL_VERSION,
      pack_id: 'world-death-note',
      prepared_token: prepared.prepared_token,
      persisted_revision: prepared.next_revision
    });
    expect(committed.committed_tick).toBe('1');
    expect(committed.summary.mutated_entity_count).toBe(2);

    const secondPrepared = await client.prepareStep({
      protocol_version: WORLD_ENGINE_PROTOCOL_VERSION,
      pack_id: 'world-death-note',
      step_ticks: '2',
      reason: 'runtime_loop'
    });
    await client.abortPreparedStep({
      protocol_version: WORLD_ENGINE_PROTOCOL_VERSION,
      pack_id: 'world-death-note',
      prepared_token: secondPrepared.prepared_token,
      reason: 'test-abort'
    });

    await client.unloadPack({ pack_id: 'world-death-note' });
    await client.stop();
  });

  it('supports structured objective rule execution roundtrip', async () => {
    const result = await client.executeObjectiveRule({
      protocol_version: WORLD_ENGINE_PROTOCOL_VERSION,
      pack_id: 'world-bridge-pack',
      invocation: {
        id: 'intent-legacy-claim:invocation',
        pack_id: 'world-bridge-pack',
        source_action_intent_id: 'intent-legacy-claim',
        source_inference_id: 'inference-legacy-claim',
        invocation_type: 'claim_book',
        capability_key: null,
        subject_entity_id: 'agent-holder',
        target_ref: null,
        payload: {
          artifact_id: 'artifact-book'
        },
        mediator_id: null,
        actor_ref: {
          agent_id: 'agent-holder'
        },
        created_at: '1000'
      },
      effective_mediator_id: null,
      objective_rules: [
        {
          id: 'claim-book-objective-rule',
          when: {
            invocation_type: 'claim_book'
          },
          then: {
            mutate: {
              target_state: {
                holder_agent_id: '{{ invocation.subject_entity_id }}'
              }
            }
          }
        }
      ],
      world_entities: [
        {
          id: 'artifact-book',
          entity_kind: 'artifact'
        }
      ]
    });

    expect(result.rule_id).toBe('stub-objective-rule');
    expect(result.bridge_mode).toBe('objective_rule');
    expect(result.mutations).toHaveLength(1);
    expect(result.mutations[0]?.entity_id).toBe('artifact-book');
    expect(result.diagnostics.matched_rule_id).toBe('stub-objective-rule');
  });
});
