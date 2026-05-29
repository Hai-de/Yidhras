import { describe, expect, it } from 'vitest';

import {
  assertWorkflowInputSourcesAreDependencyPredecessors,
  buildWorkflowTopology,
  listReadyWorkflowStepIds} from '../../../src/app/services/workflow/workflow_dag.js';
import type { WorldPackWorkflowDefinition, WorldPackWorkflowStep } from '../../../src/packs/schema/constitution_schema.js';

const makeStep = (overrides: Partial<WorldPackWorkflowStep>): WorldPackWorkflowStep => ({
  id: 'step-1',
  agent_id: 'agent-1',
  ...overrides
} as WorldPackWorkflowStep);

const makeWorkflow = (steps: WorldPackWorkflowStep[]): WorldPackWorkflowDefinition => ({
  name: 'test-workflow',
  trigger: { type: 'manual' },
  max_ticks: 100,
  steps
} as unknown as WorldPackWorkflowDefinition);

describe('workflow_dag', () => {
  describe('buildWorkflowTopology', () => {
    it('handles single step with no dependencies', () => {
      const wf = makeWorkflow([makeStep({ id: 'a' })]);
      const topo = buildWorkflowTopology(wf);
      expect(topo.orderedStepIds).toEqual(['a']);
      expect(topo.layers).toEqual([['a']]);
      expect(topo.dependencyClosureByStepId.get('a')).toEqual(new Set());
    });

    it('orders independent steps', () => {
      const wf = makeWorkflow([
        makeStep({ id: 'a' }),
        makeStep({ id: 'b' }),
        makeStep({ id: 'c' })
      ]);
      const topo = buildWorkflowTopology(wf);
      expect(topo.orderedStepIds).toHaveLength(3);
      expect(topo.layers).toHaveLength(1);
      expect(topo.layers[0]).toHaveLength(3);
    });

    it('orders linear dependency chain', () => {
      const wf = makeWorkflow([
        makeStep({ id: 'a', depends_on: ['b'] }),
        makeStep({ id: 'b', depends_on: ['c'] }),
        makeStep({ id: 'c' })
      ]);
      const topo = buildWorkflowTopology(wf);
      // c comes before b, b comes before a
      expect(topo.orderedStepIds).toEqual(['c', 'b', 'a']);
      expect(topo.layers).toEqual([['c'], ['b'], ['a']]);
    });

    it('handles diamond dependency pattern', () => {
      const wf = makeWorkflow([
        makeStep({ id: 'a', depends_on: ['b', 'c'] }),
        makeStep({ id: 'b', depends_on: ['d'] }),
        makeStep({ id: 'c', depends_on: ['d'] }),
        makeStep({ id: 'd' })
      ]);
      const topo = buildWorkflowTopology(wf);
      expect(topo.layers[0]).toEqual(['d']);
      // b and c can be in same layer
      expect(topo.layers[1]).toHaveLength(2);
      expect(topo.layers[1]).toContain('b');
      expect(topo.layers[1]).toContain('c');
      expect(topo.layers[2]).toEqual(['a']);
    });

    it('computes dependency closure', () => {
      const wf = makeWorkflow([
        makeStep({ id: 'a', depends_on: ['b'] }),
        makeStep({ id: 'b', depends_on: ['c'] }),
        makeStep({ id: 'c' })
      ]);
      const topo = buildWorkflowTopology(wf);
      expect(topo.dependencyClosureByStepId.get('a')).toEqual(new Set(['b', 'c']));
      expect(topo.dependencyClosureByStepId.get('b')).toEqual(new Set(['c']));
      expect(topo.dependencyClosureByStepId.get('c')).toEqual(new Set());
    });

    it('throws on cycle detection', () => {
      const wf = makeWorkflow([
        makeStep({ id: 'a', depends_on: ['b'] }),
        makeStep({ id: 'b', depends_on: ['a'] })
      ]);
      expect(() => buildWorkflowTopology(wf)).toThrow('cycle detected');
    });

    it('throws on unknown dependency reference', () => {
      const wf = makeWorkflow([
        makeStep({ id: 'a', depends_on: ['nonexistent'] })
      ]);
      expect(() => buildWorkflowTopology(wf)).toThrow('depends_on references unknown step');
    });
  });

  describe('listReadyWorkflowStepIds', () => {
    it('returns steps with no dependencies and pending status', () => {
      const wf = makeWorkflow([
        makeStep({ id: 'a' }),
        makeStep({ id: 'b', depends_on: ['a'] })
      ]);
      const ready = listReadyWorkflowStepIds(wf, []);
      expect(ready).toEqual(['a']);
    });

    it('returns step whose dependencies are completed', () => {
      const wf = makeWorkflow([
        makeStep({ id: 'a' }),
        makeStep({ id: 'b', depends_on: ['a'] })
      ]);
      const ready = listReadyWorkflowStepIds(wf, [
        { step_id: 'a', status: 'completed' }
      ]);
      // a is already completed, so only b is ready
      expect(ready).toEqual(['b']);
    });

    it('does not return step whose dependency is not completed', () => {
      const wf = makeWorkflow([
        makeStep({ id: 'a' }),
        makeStep({ id: 'b', depends_on: ['a'] })
      ]);
      const ready = listReadyWorkflowStepIds(wf, [
        { step_id: 'a', status: 'running' }
      ]);
      expect(ready).toEqual([]);
    });

    it('skips steps that are already running or completed', () => {
      const wf = makeWorkflow([
        makeStep({ id: 'a' }),
        makeStep({ id: 'b' })
      ]);
      const ready = listReadyWorkflowStepIds(wf, [
        { step_id: 'a', status: 'completed' },
        { step_id: 'b', status: 'running' }
      ]);
      expect(ready).toEqual([]);
    });

    it('returns multiple independent ready steps', () => {
      const wf = makeWorkflow([
        makeStep({ id: 'a' }),
        makeStep({ id: 'b' }),
        makeStep({ id: 'c', depends_on: ['a', 'b'] })
      ]);
      const ready = listReadyWorkflowStepIds(wf, []);
      expect(ready).toContain('a');
      expect(ready).toContain('b');
      expect(ready).not.toContain('c');
    });

    it('returns empty for empty workflow', () => {
      const wf = makeWorkflow([]);
      expect(listReadyWorkflowStepIds(wf, [])).toEqual([]);
    });
  });

  describe('assertWorkflowInputSourcesAreDependencyPredecessors', () => {
    it('passes when input_from references are in dependency closure', () => {
      const wf = makeWorkflow([
        makeStep({ id: 'a' }),
        makeStep({ id: 'b', depends_on: ['a'] }),
        makeStep({ id: 'c', depends_on: ['b'], input_from: ['a'] })
      ]);
      expect(() => assertWorkflowInputSourcesAreDependencyPredecessors(wf)).not.toThrow();
    });

    it('throws when input_from references non-predecessor', () => {
      const wf = makeWorkflow([
        makeStep({ id: 'a' }),
        makeStep({ id: 'b' }),
        makeStep({ id: 'c', depends_on: ['a'], input_from: ['b'] })
      ]);
      expect(() => assertWorkflowInputSourcesAreDependencyPredecessors(wf)).toThrow(
        'input_from must reference a dependency predecessor'
      );
    });

    it('passes for workflow with no input_from', () => {
      const wf = makeWorkflow([
        makeStep({ id: 'a' }),
        makeStep({ id: 'b', depends_on: ['a'] })
      ]);
      expect(() => assertWorkflowInputSourcesAreDependencyPredecessors(wf)).not.toThrow();
    });
  });
});
