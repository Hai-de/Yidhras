import { describe, expect, it } from 'vitest';

import { createRuleBasedInferenceProvider } from '../../src/inference/providers/rule_based.js';
import type { InferenceContext,PromptBundle  } from '../../src/inference/types.js';

const promptBundle: PromptBundle = {
  system_prompt: '',
  role_prompt: '',
  world_prompt: '',
  context_prompt: '',
  output_contract_prompt: '',
  combined_prompt: '',
  metadata: {
    prompt_version: null,
    source_prompt_keys: []
  }
};

const buildInferenceContext = (input?: {
  actorRoles?: string[];
  actorState?: Record<string, unknown>;
  worldState?: Record<string, unknown>;
  latestEventSemanticType?: string | null;
}): InferenceContext => ({
  inference_id: 'rule-based-death-note-provider-test',
  actor_ref: {
    identity_id: 'agent-001',
    identity_type: 'agent',
    role: 'active',
    agent_id: 'agent-001',
    atmosphere_node_id: null
  },
  actor_display_name: '夜神月',
  identity: {
    id: 'agent-001',
    type: 'agent',
    name: '夜神月',
    provider: null,
    status: null,
    claims: null
  },
  binding_ref: null,
  resolved_agent_id: 'agent-001',
  agent_snapshot: {
    id: 'agent-001',
    name: '夜神月',
    type: 'active',
    snr: 0.8,
    is_pinned: false
  },
  tick: 1000n,
  strategy: 'rule_based',
  attributes: {},
  world_pack: {
    id: 'world-death-note',
    name: '死亡笔记',
    version: '0.5.0'
  },
  world_prompts: {},
  world_ai: {
    tasks: {
      agent_decision: {
        metadata: { rule_based_profile: 'notebook_investigation_reference_v1' }
      }
    }
  },
  visible_variables: {},
  variable_context: {
    layers: [],
    alias_precedence: ['request', 'actor', 'runtime', 'pack', 'app', 'system'],
    strict_namespace: false
  },
  variable_context_summary: {
    namespaces: [],
    alias_precedence: ['request', 'actor', 'runtime', 'pack', 'app', 'system'],
    strict_namespace: false,
    layer_count: 0
  },
  policy_summary: {
    social_post_read_allowed: true,
    social_post_readable_fields: ['id', 'content'],
    social_post_write_allowed: true,
    social_post_writable_fields: ['content']
  },
  transmission_profile: {
    policy: 'reliable',
    drop_reason: null,
    delay_ticks: '1',
    drop_chance: 0,
    derived_from: ['test']
  },
  context_run: {
    id: 'context-run-provider-test',
    created_at_tick: '1000',
    selected_node_ids: [],
    nodes: [],
    diagnostics: {
      source_adapter_names: [],
      node_count: 0,
      node_counts_by_type: {},
      selected_node_ids: [],
      dropped_nodes: []
    }
  },
  memory_context: {
    short_term: [],
    long_term: [],
    summaries: [],
    diagnostics: {
      selected_count: 0,
      skipped_count: 0
    }
  },
  pack_state: {
    actor_roles: input?.actorRoles ?? ['notebook_candidate', 'planner'],
    actor_state: {
      murderous_intent: false,
      knows_notebook_power: true,
      current_target_id: null,
      known_target_id: 'agent-002',
      target_judgement_eligibility: true,
      target_name_confirmed: true,
      target_face_confirmed: true,
      cover_story_stability: 1,
      suspicion_level: 0,
      evidence_chain_strength: 0,
      case_theory_strength: 0,
      last_reflection_kind: null,
      judgement_strategy_phase: 'case_assessment',
      exposure_risk: 0,
      ...(input?.actorState ?? {})
    },
    owned_artifacts: [
      {
        id: 'artifact-death-note',
        state: {}
      }
    ],
    world_state: {
      opening_phase: 'notebook_claimed',
      kira_case_phase: 'kira_active',
      investigation_heat: 1,
      death_pattern_visibility: 1,
      countermeasure_pressure: 0,
      last_case_update_kind: null,
      ...(input?.worldState ?? {})
    },
    latest_event: input?.latestEventSemanticType
      ? {
          event_id: 'event-001',
          title: 'latest event',
          type: 'history',
          semantic_type: input.latestEventSemanticType,
          created_at: '1000'
        }
      : null
  },
  pack_runtime: {
    invocation_rules: []
  }
});

describe('rule based inference provider for death note world-pack', () => {
  const provider = createRuleBasedInferenceProvider();

  it('lets notebook holder switch into misdirection when investigation pressure rises', async () => {
    const result = await provider.run(
      buildInferenceContext({
        actorRoles: ['notebook_candidate', 'planner'],
        actorState: {
          murderous_intent: false,
          knows_notebook_power: true,
          cover_story_stability: 0.6,
          suspicion_level: 0.4
        },
        worldState: {
          countermeasure_pressure: 2,
          last_case_update_kind: 'investigation_escalated'
        },
        latestEventSemanticType: 'investigation_pressure_escalated'
      }),
      promptBundle
    );
    const payload = result.payload as Record<string, unknown>;

    expect(result.action_type).toBe('semantic_intent');
    expect(payload.semantic_intent_kind).toBe('raise_false_suspicion');
    expect(result.target_ref).toMatchObject({ entity_id: 'agent-002' });
  });

  it('lets notebook holder insert post-execution reflection before restarting the kill chain', async () => {
    const result = await provider.run(
      buildInferenceContext({
        actorRoles: ['notebook_candidate', 'planner'],
        actorState: {
          murderous_intent: false,
          knows_notebook_power: true,
          current_target_id: 'agent-002',
          last_execution_outcome: 'target_eliminated',
          last_reflection_kind: null
        },
        latestEventSemanticType: 'post_execution_pressure_feedback'
      }),
      promptBundle
    );
    const payload = result.payload as Record<string, unknown>;

    expect(result.action_type).toBe('semantic_intent');
    expect(payload.semantic_intent_kind).toBe('record_execution_postmortem');
    expect(result.target_ref).toMatchObject({ entity_id: 'agent-002' });
  });

  it('lets investigator enter the suspicious death investigation chain', async () => {
    const result = await provider.run(
      buildInferenceContext({
        actorRoles: ['investigator'],
        actorState: {
          evidence_chain_strength: 0.2,
          case_theory_strength: 0.25,
          investigation_focus: null
        },
        latestEventSemanticType: 'suspicious_death_occurred'
      }),
      promptBundle
    );
    const payload = result.payload as Record<string, unknown>;

    expect(result.action_type).toBe('semantic_intent');
    expect(payload.semantic_intent_kind).toBe('investigate_death_cluster');
    expect(result.target_ref).toMatchObject({ entity_id: 'agent-001' });
  });

  it('lets investigator progress from evidence collection into coordination', async () => {
    const result = await provider.run(
      buildInferenceContext({
        actorRoles: ['investigator'],
        actorState: {
          evidence_chain_strength: 0.7,
          case_theory_strength: 0.72,
          investigation_focus: 'kira_case'
        },
        worldState: {
          investigation_heat: 2,
          countermeasure_pressure: 2,
          last_case_update_kind: 'intel_shared'
        }
      }),
      promptBundle
    );
    const payload = result.payload as Record<string, unknown>;

    expect(result.action_type).toBe('semantic_intent');
    expect(payload.semantic_intent_kind).toBe('request_joint_observation');
    expect(result.target_ref).toMatchObject({ entity_id: 'agent-003' });
  });

  it('lets investigator update dossier before sharing high-confidence case intel', async () => {
    const result = await provider.run(
      buildInferenceContext({
        actorRoles: ['investigator'],
        actorState: {
          evidence_chain_strength: 0.62,
          case_theory_strength: 0.6,
          investigation_focus: 'kira_case',
          last_reflection_kind: null,
          judgement_strategy_phase: 'case_assessment'
        },
        worldState: {
          investigation_heat: 2,
          countermeasure_pressure: 1,
          last_case_update_kind: null
        }
      }),
      promptBundle
    );
    const payload = result.payload as Record<string, unknown>;

    expect(result.action_type).toBe('semantic_intent');
    expect(payload.semantic_intent_kind).toBe('update_target_dossier');
  });

  it('lets notebook holder revise plan before re-entering an execution chain after intent reaffirmation', async () => {
    const result = await provider.run(
      buildInferenceContext({
        actorRoles: ['notebook_candidate', 'planner'],
        actorState: {
          murderous_intent: false,
          knows_notebook_power: true,
          current_target_id: null,
          known_target_id: null,
          target_judgement_eligibility: false,
          target_name_confirmed: false,
          target_face_confirmed: false,
          last_execution_outcome: 'intent_reaffirmed',
          last_reflection_kind: null,
          judgement_strategy_phase: 'case_assessment'
        },
        worldState: {
          countermeasure_pressure: 0,
          last_case_update_kind: null
        }
      }),
      promptBundle
    );
    const payload = result.payload as Record<string, unknown>;

    expect(result.action_type).toBe('semantic_intent');
    expect(payload.semantic_intent_kind).toBe('revise_judgement_plan');
    expect(result.target_ref).toMatchObject({ entity_id: 'agent-002' });
  });

  it('keeps shinigami-like observer on a narrative observation track', async () => {
    const result = await provider.run(
      buildInferenceContext({
        actorRoles: ['observer', 'shinigami'],
        actorState: {
          amused: true
        },
        latestEventSemanticType: 'post_execution_pressure_feedback'
      }),
      promptBundle
    );
    const payload = result.payload as Record<string, unknown>;

    expect(result.action_type).toBe('trigger_event');
    expect(payload.event_type).toBe('history');
    expect(payload.impact_data).toMatchObject({
      semantic_type: 'observer_reaction',
      observed_semantic_type: 'post_execution_pressure_feedback'
    });
  });
});
