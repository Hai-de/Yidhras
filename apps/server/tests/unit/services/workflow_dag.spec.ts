import { describe, expect, it } from 'vitest';

import {
  buildWorkflowTopology,
  listReadyWorkflowStepIds,
  assertWorkflowInputSourcesAreDependencyPredecessors
} from '../../../src/app/services/workflow/workflow_dag.js';

const makeWorkflow = (steps: Array<{ id: string; depends_on?: string[]; input_from?: string[]; agent?: string }>) => ({
  trigger: { type: 'manual' as const },
  max_ticks: 100,
  steps: steps.map(s => ({
    id: s.id,
    agent: s.agent ?? 'agent-1',
    depends_on: s.depends_on,
    input_from: s.input_from,
    inference: { provider: 'behavior_tree' as const, behavior_tree: 'bt1' }
  }))
});

describe('buildWorkflowTopology', () => {
  it('handles single step with no dependencies', () => {
    const workflow = makeWorkflow([{ id: 'a' }]);
    const topo = buildWorkflowTopology(workflow);
    expect(topo.orderedStepIds).toEqual(['a']);
    expect(topo.layers).toEqual([['a']]);
    expect(topo.dependencyClosureByStepId.get('a')?.size).toBe(0);
  });

  it('handles linear chain: a -> b -> c', () => {
    const workflow = makeWorkflow([{ id: 'c', depends_on: ['b'] }, { id: 'b', depends_on: ['a'] }, { id: 'a' }]);
    const topo = buildWorkflowTopology(workflow);
    expect(topo.layers).toEqual([['a'], ['b'], ['c']]);
    expect(topo.dependencyClosureByStepId.get('c')).toEqual(new Set(['a', 'b']));
  });

  it('handles diamond: a -> b, a -> c, b+c -> d', () => {
    const workflow = makeWorkflow([
      { id: 'd', depends_on: ['b', 'c'] },
      { id: 'b', depends_on: ['a'] },
      { id: 'c', depends_on: ['a'] },
      { id: 'a' }
    ]);
    const topo = buildWorkflowTopology(workflow);
    expect(topo.layers[0]).toEqual(['a']);
    expect(new Set(topo.layers[1])).toEqual(new Set(['b', 'c']));
    expect(topo.layers[2]).toEqual(['d']);
  });

  it('detects cycle', () => {
    const workflow = makeWorkflow([{ id: 'a', depends_on: ['b'] }, { id: 'b', depends_on: ['a'] }]);
    expect(() => buildWorkflowTopology(workflow)).toThrow(/cycle detected/);
  });

  it('throws on unknown dependency reference', () => {
    const workflow = makeWorkflow([{ id: 'a', depends_on: ['nonexistent'] }]);
    expect(() => buildWorkflowTopology(workflow)).toThrow(/unknown step/);
  });
});

describe('listReadyWorkflowStepIds', () => {
  it('returns steps with no dependencies when no step states provided', () => {
    const workflow = makeWorkflow([{ id: 'a' }, { id: 'b', depends_on: ['a'] }]);
    const ready = listReadyWorkflowStepIds(workflow, []);
    expect(ready).toEqual(['a']);
  });

  it('returns step whose dependencies are completed', () => {
    const workflow = makeWorkflow([{ id: 'a' }, { id: 'b', depends_on: ['a'] }]);
    const ready = listReadyWorkflowStepIds(workflow, [{ step_id: 'a', status: 'completed' }]);
    expect(ready).toEqual(['b']);
  });

  it('still returns pending independent step even when other step is pending', () => {
    const workflow = makeWorkflow([{ id: 'a' }, { id: 'b', depends_on: ['a'] }]);
    // a is pending (no deps) → a is still ready; b depends on a which is not completed → b not ready
    const ready = listReadyWorkflowStepIds(workflow, [{ step_id: 'a', status: 'pending' }]);
    expect(ready).toEqual(['a']);
  });

  it('excludes already-completed steps', () => {
    const workflow = makeWorkflow([{ id: 'a' }, { id: 'b' }]);
    const ready = listReadyWorkflowStepIds(workflow, [{ step_id: 'a', status: 'completed' }]);
    expect(ready).toEqual(['b']);
  });

  it('returns empty for fully completed workflow', () => {
    const workflow = makeWorkflow([{ id: 'a' }, { id: 'b' }]);
    const ready = listReadyWorkflowStepIds(workflow, [
      { step_id: 'a', status: 'completed' },
      { step_id: 'b', status: 'completed' }
    ]);
    expect(ready).toEqual([]);
  });
});

describe('assertWorkflowInputSourcesAreDependencyPredecessors', () => {
  it('passes when input_from references dependency predecessor', () => {
    const workflow = makeWorkflow([
      { id: 'a' },
      { id: 'b', depends_on: ['a'], input_from: ['a'] }
    ]);
    expect(() => assertWorkflowInputSourcesAreDependencyPredecessors(workflow)).not.toThrow();
  });

  it('passes when no input_from specified', () => {
    const workflow = makeWorkflow([{ id: 'a' }, { id: 'b', depends_on: ['a'] }]);
    expect(() => assertWorkflowInputSourcesAreDependencyPredecessors(workflow)).not.toThrow();
  });

  it('throws when input_from references non-dependency', () => {
    const workflow = makeWorkflow([
      { id: 'a' },
      { id: 'b' },
      { id: 'c', depends_on: ['a'], input_from: ['b'] }
    ]);
    expect(() => assertWorkflowInputSourcesAreDependencyPredecessors(workflow)).toThrow(
      /input_from must reference a dependency predecessor/
    );
  });
});
