import { describe, expect, it } from 'vitest';

import {
  assertWorkflowInputSourcesAreDependencyPredecessors,
  buildWorkflowTopology,
  listReadyWorkflowStepIds
} from '../../../src/app/services/workflow/workflow_dag.js';
import type { WorldPackWorkflowDefinition } from '../../../src/packs/schema/constitution_schema.js';

const workflow: WorldPackWorkflowDefinition = {
  trigger: { type: 'manual' },
  max_ticks: 10,
  steps: [
    {
      id: 'draft',
      agent: 'proposer',
      inference: { provider: 'behavior_tree', behavior_tree: 'draft' }
    },
    {
      id: 'legal_review',
      agent: 'reviewer',
      depends_on: ['draft'],
      input_from: ['draft'],
      inference: { provider: 'behavior_tree', behavior_tree: 'legal_review' }
    },
    {
      id: 'risk_review',
      agent: 'reviewer',
      depends_on: ['draft'],
      input_from: ['draft'],
      inference: { provider: 'behavior_tree', behavior_tree: 'risk_review' }
    },
    {
      id: 'approve',
      agent: 'approver',
      depends_on: ['legal_review', 'risk_review'],
      input_from: ['legal_review', 'risk_review'],
      inference: { provider: 'behavior_tree', behavior_tree: 'approve' }
    }
  ]
};

describe('workflow DAG helpers', () => {
  it('builds topological order and fan-out/gather layers', () => {
    const topology = buildWorkflowTopology(workflow);

    expect(topology.orderedStepIds).toEqual(['draft', 'legal_review', 'risk_review', 'approve']);
    expect(topology.layers).toEqual([
      ['draft'],
      ['legal_review', 'risk_review'],
      ['approve']
    ]);
    expect(topology.dependencyClosureByStepId.get('approve')).toEqual(new Set(['draft', 'legal_review', 'risk_review']));
  });

  it('lists pending steps whose dependencies are completed', () => {
    expect(listReadyWorkflowStepIds(workflow, [])).toEqual(['draft']);
    expect(listReadyWorkflowStepIds(workflow, [
      { step_id: 'draft', status: 'completed' },
      { step_id: 'legal_review', status: 'pending' },
      { step_id: 'risk_review', status: 'pending' },
      { step_id: 'approve', status: 'pending' }
    ])).toEqual(['legal_review', 'risk_review']);
    expect(listReadyWorkflowStepIds(workflow, [
      { step_id: 'draft', status: 'completed' },
      { step_id: 'legal_review', status: 'completed' },
      { step_id: 'risk_review', status: 'completed' },
      { step_id: 'approve', status: 'pending' }
    ])).toEqual(['approve']);
  });

  it('rejects cycles', () => {
    const cyclicWorkflow: WorldPackWorkflowDefinition = {
      trigger: { type: 'manual' },
      max_ticks: 5,
      steps: [
        {
          id: 'a',
          agent: 'a',
          depends_on: ['b'],
          inference: { provider: 'behavior_tree', behavior_tree: 'a' }
        },
        {
          id: 'b',
          agent: 'b',
          depends_on: ['a'],
          inference: { provider: 'behavior_tree', behavior_tree: 'b' }
        }
      ]
    };

    expect(() => buildWorkflowTopology(cyclicWorkflow)).toThrow(/acyclic|cycle/);
  });

  it('requires input_from reference dependency predecessors', () => {
    const invalidWorkflow: WorldPackWorkflowDefinition = {
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
    };

    expect(() => assertWorkflowInputSourcesAreDependencyPredecessors(invalidWorkflow)).toThrow(/dependency predecessor/);
  });
});
