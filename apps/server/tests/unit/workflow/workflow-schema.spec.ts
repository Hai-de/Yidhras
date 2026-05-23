import { describe, expect, it } from 'vitest';

import { parseWorldPackConstitution } from '../../../src/packs/schema/constitution_schema.js';

const basePack = {
  metadata: {
    id: 'workflow-schema-test-pack',
    name: 'Workflow Schema Test Pack',
    version: '1.0.0'
  },
  entities: {
    actors: [
      { id: 'proposer', label: 'Proposer', kind: 'actor' },
      { id: 'reviewer', label: 'Reviewer', kind: 'actor' },
      { id: 'approver', label: 'Approver', kind: 'actor' }
    ],
    collectives: [],
    artifacts: [],
    mediators: [],
    domains: [],
    institutions: []
  }
};

describe('world pack workflows schema', () => {
  it('accepts a valid manual DAG workflow declaration', () => {
    const pack = parseWorldPackConstitution({
      ...basePack,
      workflows: {
        proposal_review: {
          trigger: { type: 'manual' },
          max_ticks: 10,
          lock_policy: 'active_steps',
          failure_policy: 'narrativize',
          steps: [
            {
              id: 'draft',
              agent: 'proposer',
              inference: { provider: 'behavior_tree', behavior_tree: 'draft_proposal' }
            },
            {
              id: 'review',
              agent: 'reviewer',
              depends_on: ['draft'],
              input_from: ['draft'],
              inference: { provider: 'behavior_tree', behavior_tree: 'review_proposal' }
            },
            {
              id: 'approve',
              agent: 'approver',
              depends_on: ['review'],
              input_from: ['review'],
              condition: {
                field: 'review.grounding_result.type',
                op: 'eq',
                value: 'exact'
              },
              inference: { provider: 'anthropic', model: 'claude-test' }
            }
          ]
        }
      }
    });

    expect(pack.workflows?.proposal_review?.steps).toHaveLength(3);
    expect(pack.workflows?.proposal_review?.lock_policy).toBe('active_steps');
  });

  it('accepts an event-triggered workflow with event_types', () => {
    const pack = parseWorldPackConstitution({
      ...basePack,
      workflows: {
        incident_review: {
          trigger: { type: 'event', event_types: ['incident.reported'] },
          max_ticks: 5,
          steps: [
            {
              id: 'review',
              agent: 'reviewer',
              inference: { provider: 'openai_compatible', model: 'test-model' }
            }
          ]
        }
      }
    });

    expect(pack.workflows?.incident_review?.trigger.type).toBe('event');
  });

  it('rejects manual trigger event_types', () => {
    expect(() =>
      parseWorldPackConstitution({
        ...basePack,
        workflows: {
          bad_manual: {
            trigger: { type: 'manual', event_types: ['not.allowed'] },
            max_ticks: 5,
            steps: [
              {
                id: 'start',
                agent: 'proposer',
                inference: { provider: 'behavior_tree', behavior_tree: 'start' }
              }
            ]
          }
        }
      })
    ).toThrow(/event_types|Unrecognized key/);
  });

  it('rejects whole_workflow lock_policy in Phase 1', () => {
    expect(() =>
      parseWorldPackConstitution({
        ...basePack,
        workflows: {
          bad_lock: {
            trigger: { type: 'manual' },
            max_ticks: 5,
            lock_policy: 'whole_workflow',
            steps: [
              {
                id: 'start',
                agent: 'proposer',
                inference: { provider: 'behavior_tree', behavior_tree: 'start' }
              }
            ]
          }
        }
      })
    ).toThrow(/active_steps|Invalid input/);
  });

  it('rejects combination conditions in Phase 1', () => {
    expect(() =>
      parseWorldPackConstitution({
        ...basePack,
        workflows: {
          bad_condition: {
            trigger: { type: 'manual' },
            max_ticks: 5,
            steps: [
              {
                id: 'draft',
                agent: 'proposer',
                inference: { provider: 'behavior_tree', behavior_tree: 'draft' }
              },
              {
                id: 'review',
                agent: 'reviewer',
                depends_on: ['draft'],
                condition: { all_of: [{ field: 'draft.result', op: 'eq', value: true }] },
                inference: { provider: 'behavior_tree', behavior_tree: 'review' }
              }
            ]
          }
        }
      })
    ).toThrow(/field|all_of|Unrecognized key/);
  });

  it('rejects unknown provider model_routed', () => {
    expect(() =>
      parseWorldPackConstitution({
        ...basePack,
        workflows: {
          bad_provider: {
            trigger: { type: 'manual' },
            max_ticks: 5,
            steps: [
              {
                id: 'start',
                agent: 'proposer',
                inference: { provider: 'model_routed', behavior_tree: 'start' }
              }
            ]
          }
        }
      })
    ).toThrow(/provider|Invalid input/);
  });

  it('rejects unknown depends_on references', () => {
    expect(() =>
      parseWorldPackConstitution({
        ...basePack,
        workflows: {
          bad_dependency: {
            trigger: { type: 'manual' },
            max_ticks: 5,
            steps: [
              {
                id: 'review',
                agent: 'reviewer',
                depends_on: ['missing'],
                inference: { provider: 'behavior_tree', behavior_tree: 'review' }
              }
            ]
          }
        }
      })
    ).toThrow(/depends_on references unknown step/);
  });

  it('rejects cyclic depends_on graphs', () => {
    expect(() =>
      parseWorldPackConstitution({
        ...basePack,
        workflows: {
          cyclic: {
            trigger: { type: 'manual' },
            max_ticks: 5,
            steps: [
              {
                id: 'a',
                agent: 'proposer',
                depends_on: ['b'],
                inference: { provider: 'behavior_tree', behavior_tree: 'a' }
              },
              {
                id: 'b',
                agent: 'reviewer',
                depends_on: ['a'],
                inference: { provider: 'behavior_tree', behavior_tree: 'b' }
              }
            ]
          }
        }
      })
    ).toThrow(/acyclic/);
  });

  it('rejects input_from that is not an earlier dependency predecessor', () => {
    expect(() =>
      parseWorldPackConstitution({
        ...basePack,
        workflows: {
          bad_input: {
            trigger: { type: 'manual' },
            max_ticks: 5,
            steps: [
              {
                id: 'draft',
                agent: 'proposer',
                inference: { provider: 'behavior_tree', behavior_tree: 'draft' }
              },
              {
                id: 'review',
                agent: 'reviewer',
                input_from: ['draft'],
                inference: { provider: 'behavior_tree', behavior_tree: 'review' }
              }
            ]
          }
        }
      })
    ).toThrow(/input_from must reference a dependency predecessor/);
  });
});
