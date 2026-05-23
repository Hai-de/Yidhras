import type { WorldPackWorkflowDefinition, WorldPackWorkflowStep } from '../../../packs/schema/constitution_schema.js';
import type { WorkflowStepRunStatus } from './workflow_types.js';

export interface WorkflowTopology {
  orderedStepIds: string[];
  layers: string[][];
  dependencyClosureByStepId: Map<string, Set<string>>;
}

export interface WorkflowStepStateLike {
  step_id: string;
  status: WorkflowStepRunStatus;
}

const createStepMap = (workflow: WorldPackWorkflowDefinition): Map<string, WorldPackWorkflowStep> => {
  return new Map(workflow.steps.map(step => [step.id, step]));
};

const getDependencyIds = (step: WorldPackWorkflowStep): string[] => step.depends_on ?? [];

export const buildWorkflowTopology = (workflow: WorldPackWorkflowDefinition): WorkflowTopology => {
  const stepMap = createStepMap(workflow);
  const orderedStepIds: string[] = [];
  const permanent = new Set<string>();
  const temporary = new Set<string>();
  const dependencyClosureByStepId = new Map<string, Set<string>>();

  const visit = (stepId: string): void => {
    if (permanent.has(stepId)) return;
    if (temporary.has(stepId)) {
      throw new Error(`workflow depends_on graph must be acyclic; cycle detected at step "${stepId}"`);
    }

    const step = stepMap.get(stepId);
    if (!step) {
      throw new Error(`workflow depends_on references unknown step "${stepId}"`);
    }

    temporary.add(stepId);
    for (const dependencyStepId of getDependencyIds(step)) {
      if (!stepMap.has(dependencyStepId)) {
        throw new Error(`workflow step "${step.id}" depends_on references unknown step "${dependencyStepId}"`);
      }
      visit(dependencyStepId);
    }
    temporary.delete(stepId);
    permanent.add(stepId);
    orderedStepIds.push(stepId);
  };

  for (const step of workflow.steps) {
    visit(step.id);
  }

  const collectDependencyClosure = (stepId: string, seen = new Set<string>()): Set<string> => {
    const step = stepMap.get(stepId);
    if (!step) return seen;
    for (const dependencyStepId of getDependencyIds(step)) {
      if (!seen.has(dependencyStepId)) {
        seen.add(dependencyStepId);
        collectDependencyClosure(dependencyStepId, seen);
      }
    }
    return seen;
  };

  for (const step of workflow.steps) {
    dependencyClosureByStepId.set(step.id, collectDependencyClosure(step.id));
  }

  const remaining = new Set(orderedStepIds);
  const completedForLayering = new Set<string>();
  const layers: string[][] = [];

  while (remaining.size > 0) {
    const layer = orderedStepIds.filter(stepId => {
      if (!remaining.has(stepId)) return false;
      const step = stepMap.get(stepId);
      if (!step) return false;
      return getDependencyIds(step).every(dependencyStepId => completedForLayering.has(dependencyStepId));
    });

    if (layer.length === 0) {
      throw new Error('workflow depends_on graph must be acyclic; no topological layer can be resolved');
    }

    layers.push(layer);
    for (const stepId of layer) {
      remaining.delete(stepId);
      completedForLayering.add(stepId);
    }
  }

  return { orderedStepIds, layers, dependencyClosureByStepId };
};

export const listReadyWorkflowStepIds = (
  workflow: WorldPackWorkflowDefinition,
  stepStates: WorkflowStepStateLike[]
): string[] => {
  const stateByStepId = new Map(stepStates.map(state => [state.step_id, state.status]));
  const readyStepIds: string[] = [];

  for (const step of workflow.steps) {
    const currentStatus = stateByStepId.get(step.id) ?? 'pending';
    if (currentStatus !== 'pending') continue;
    const dependenciesCompleted = getDependencyIds(step).every(dependencyStepId => stateByStepId.get(dependencyStepId) === 'completed');
    if (dependenciesCompleted) {
      readyStepIds.push(step.id);
    }
  }

  return readyStepIds;
};

export const assertWorkflowInputSourcesAreDependencyPredecessors = (workflow: WorldPackWorkflowDefinition): void => {
  const topology = buildWorkflowTopology(workflow);

  for (const step of workflow.steps) {
    const dependencyClosure = topology.dependencyClosureByStepId.get(step.id) ?? new Set<string>();
    for (const inputStepId of step.input_from ?? []) {
      if (!dependencyClosure.has(inputStepId)) {
        throw new Error(`workflow step "${step.id}" input_from must reference a dependency predecessor; "${inputStepId}" is not in depends_on closure`);
      }
    }
  }
};
