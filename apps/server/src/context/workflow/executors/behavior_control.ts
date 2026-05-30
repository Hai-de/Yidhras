import { getBehaviorStateStore } from '../../../app/behavior_state_store.js';
import type { ConversationEntry } from '../../../conversation/types.js';
import type { PromptTree } from '../../../inference/prompt_tree.js';
import type { SlotBehaviorProfile } from '../../../inference/slot_behavior.js';
import {
  applyStateTransitions,
  createInitialBehaviorState,
  type SlotBehaviorState
} from '../../../inference/slot_behavior_state.js';
import {
  evaluateBuiltinCondition,
  evaluateCustomCondition,
  type SlotConditionContext
} from '../../../inference/slot_condition_evaluators.js';
import {
  resolveBudgetAllocation,
  resolveExclusiveGroup,
  resolvePriorityOrder,
  resolveSlotGroups
} from '../../../inference/slot_group_resolver.js';
import { evaluateTriggerProbability } from '../../../inference/slot_trigger_probability.js';
import type { InferenceContext } from '../../../inference/types.js';
import type { PromptWorkflowStepExecutor } from '../registry.js';
import { resolvePromptWorkflowBudget } from '../token_budget.js';
import type {
  PromptWorkflowState,
  PromptWorkflowStepTrace,
  SlotBehaviorDiagnostic,
  StepSnapshotSummary
} from '../types.js';

// ── helpers ──

function getVisibleConversationEntries(context: InferenceContext): ConversationEntry[] {
  const entries = context.agent_conversation_memory?.entries ?? [];
  return entries
    .filter((entry) => !entry.archived)
    .sort((left, right) => left.turn_number - right.turn_number);
}

function extractLastUserMessage(context: InferenceContext): string {
  const entries = getVisibleConversationEntries(context);
  if (entries.length === 0) {
    return '';
  }

  const currentAgentId = context.current_agent_id ?? context.resolved_agent_id ?? context.actor_ref.agent_id ?? context.actor_ref.identity_id;
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i]!;
    if (entry.speaker_agent_id !== currentAgentId) {
      return entry.current_content;
    }
  }
  return '';
}

function extractConversationMeta(context: InferenceContext): {
  turn_count: number;
  last_message_role?: string;
} {
  const entries = getVisibleConversationEntries(context);
  const last = entries[entries.length - 1];
  const currentAgentId = context.current_agent_id ?? context.resolved_agent_id ?? context.actor_ref.agent_id ?? context.actor_ref.identity_id;
// @ts-expect-error -- EOPT strict mode
  return {
    turn_count: entries.length,
    last_message_role: last
      ? last.speaker_agent_id === currentAgentId ? 'assistant' : 'user'
      : undefined
  };
}

function estimateTokenBudget(tree: PromptTree, total: number): {
  total: number;
  used: number;
  remaining: number;
} {
  let used = 0;
  for (const fragments of Object.values(tree.fragments_by_slot)) {
    for (const fragment of fragments) {
      if (!fragment.permission_denied) {
        used += fragment.estimated_tokens ?? 0;
      }
    }
  }
  return { total, used, remaining: Math.max(0, total - used) };
}

function buildSlotConditionContext(
  context: InferenceContext,
  state: PromptWorkflowState,
  slotId: string,
  currentTick: number,
  modelContextWindow: number
): SlotConditionContext {
  return {
    slot_id: slotId,
    variables: {},
    conversation_meta: extractConversationMeta(context),
    token_budget: state.tree ? estimateTokenBudget(state.tree, modelContextWindow) : { total: modelContextWindow, used: 0, remaining: modelContextWindow },
    current_tick: currentTick,
    last_user_message: extractLastUserMessage(context)
  };
}

function disableSlotContent(tree: PromptTree, slotId: string): void {
  // eslint-disable-next-line security/detect-object-injection
  const fragments = tree.fragments_by_slot[slotId];
  if (!fragments) {
    return;
  }
  for (const fragment of fragments) {
    fragment.permission_denied = true;
  }
}

const IGNORE_CONTEXT_LENGTH_KEY = 'ignore_context_length';

function markIgnoreContextLength(tree: PromptTree, slotId: string): void {
  // eslint-disable-next-line security/detect-object-injection
  const fragments = tree.fragments_by_slot[slotId];
  if (!fragments) {
    return;
  }
  for (const fragment of fragments) {
    fragment.metadata = {
      ...fragment.metadata,
      [IGNORE_CONTEXT_LENGTH_KEY]: true
    };
  }
}

function enforceIgnoreContextLengthHardLimit(tree: PromptTree, modelContextWindow: number): void {
  const hardLimit = Math.floor(modelContextWindow * 0.8);
  let totalIgnoreTokens = 0;

  // Collect all ignore_context_length fragments with their token estimates
  const ignoredFragments: { slotId: string; fragment: (typeof tree.fragments_by_slot)[string][number]; tokens: number }[] = [];
  for (const [slotId, fragments] of Object.entries(tree.fragments_by_slot)) {
    for (const fragment of fragments) {
      if (fragment.metadata?.[IGNORE_CONTEXT_LENGTH_KEY]) {
        const tokens = fragment.estimated_tokens ?? 0;
        totalIgnoreTokens += tokens;
        ignoredFragments.push({ slotId, fragment, tokens });
      }
    }
  }

  if (totalIgnoreTokens <= hardLimit) {
    return;
  }

  // Exceeded hard limit: disable lowest priority fragments first
  ignoredFragments.sort((a, b) => a.fragment.priority - b.fragment.priority);

  for (const { fragment } of ignoredFragments) {
    if (totalIgnoreTokens <= hardLimit) {
      break;
    }
    const tokens = fragment.estimated_tokens ?? 0;
    fragment.permission_denied = true;
    totalIgnoreTokens -= tokens;
  }
}

function buildSummary(state: PromptWorkflowState): StepSnapshotSummary {
  const tree = state.tree;
  if (!tree) {
    return {
      section_drafts_count: 0,
      fragment_count: 0,
      total_estimated_tokens: 0,
      denied_fragment_count: 0,
      working_set_node_count: 0
    };
  }

  let fragmentCount = 0;
  let totalTokens = 0;
  let deniedCount = 0;
  for (const fragments of Object.values(tree.fragments_by_slot)) {
    for (const fragment of fragments) {
      fragmentCount++;
      if (fragment.permission_denied) {
        deniedCount++;
      } else {
        totalTokens += fragment.estimated_tokens ?? 0;
      }
    }
  }

  return {
    section_drafts_count: state.section_drafts.length,
    fragment_count: fragmentCount,
    total_estimated_tokens: totalTokens,
    denied_fragment_count: deniedCount,
    working_set_node_count: state.working_set.length
  };
}

// ── activation evaluation ──

interface ActivationDecision {
  active: boolean;
  reason?: string;
  confidence?: number;
}

async function evaluateSlotActivation(
  profile: SlotBehaviorProfile,
  behaviorState: SlotBehaviorState | undefined,
  context: InferenceContext,
  state: PromptWorkflowState,
  currentTick: number,
  modelContextWindow: number
): Promise<ActivationDecision> {
  // Phase 2: state-based activation gates (Cooling/Delayed)
  if (behaviorState) {
    // Cooling takes highest priority — skip even if always_active
    if (behaviorState.status === 'Cooling') {
      if (currentTick < (behaviorState.cooldown_until_tick ?? 0)) {
        return { active: false, reason: 'cooling: cooldown not elapsed' };
      }
    }

    // Delayed — not yet active
    if (behaviorState.status === 'Delayed') {
      if (currentTick < (behaviorState.delay_until_tick ?? 0)) {
        return { active: false, reason: 'delayed: delay not elapsed' };
      }
    }
  }

  const ctx = buildSlotConditionContext(context, state, profile.slot_id, currentTick, modelContextWindow);

  // always_active: skip all condition checks
  if (profile.always_active) {
    return { active: true, reason: 'always_active' };
  }

  // trigger_probability: deterministic sampling
  if (profile.trigger_probability !== undefined) {
    const triggerCount = behaviorState?.trigger_count ?? 0;
    const active = evaluateTriggerProbability(
      profile.trigger_probability,
      profile.slot_id,
      currentTick,
      triggerCount
    );
    if (!active) {
      return { active: false, reason: 'trigger_probability gate not met' };
    }
  }

  // conditions: AND/OR semantics
  const conditions = profile.conditions;
  if (!conditions || conditions.length === 0) {
    // No conditions → active by default
    return { active: true, reason: 'no conditions to evaluate' };
  }

  const combination = profile.condition_combination ?? 'and';

  type EvalResult = { active: boolean; error?: string };
  const results: EvalResult[] = [];

  for (const condition of conditions) {
    try {
      let result: { active: boolean; reason?: string };
      if (condition.type === 'custom') {
        // Phase 5: query per-pack registry for custom evaluator
        result = await evaluateCustomCondition(
          state.pack_id,
          condition.evaluator_key,
          ctx
        );
      } else {
        result = evaluateBuiltinCondition(condition, ctx);
      }
      results.push({ active: result.active });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      results.push({ active: false, error: message });
    }
  }

  if (combination === 'and') {
    const allActive = results.every((r) => r.active);
    const firstError = results.find((r) => r.error);
    return {
      active: allActive,
      reason: allActive
        ? 'all conditions met (AND)'
        : `conditions not met: ${firstError?.error ?? 'one or more failed'}`
    };
  }

  // OR combination
  const anyActive = results.some((r) => r.active);
  return {
    active: anyActive,
    reason: anyActive ? 'at least one condition met (OR)' : 'no conditions met (OR)'
  };
}

// ── executor ──

export const createBehaviorControlExecutor = (): PromptWorkflowStepExecutor => ({
  kind: 'behavior_control',
   
  async execute({ context, state, spec }) {
    const beforeSummary = buildSummary(state);

    const behaviorProfiles = state.behavior_profiles;
    if (!behaviorProfiles || behaviorProfiles.length === 0 || !state.tree) {
      const trace: PromptWorkflowStepTrace = {
        key: spec.key,
        kind: 'behavior_control',
        status: 'completed',
        before: beforeSummary,
        after: state.tree ? buildSummary(state) : beforeSummary,
        notes: { skipped: true, reason: !state.tree ? 'no tree' : 'no behavior profiles' }
      };
      state.diagnostics.step_traces.push(trace);
      return state;
    }

    const currentTick = Number(context.tick);
    const budgetResolution = resolvePromptWorkflowBudget({ profile: state.profile, spec });
    const behaviorStates: Record<string, SlotBehaviorState> = { ...state.behavior_states };
    const packId = state.pack_id;
    const stateStore = getBehaviorStateStore();

    // Phase 2: load persisted states from store, merge with workflow state
    if (stateStore) {
      for (const profile of behaviorProfiles) {
        const stored = stateStore.getState(profile.slot_id, packId);
        if (stored && !behaviorStates[profile.slot_id]) {
          behaviorStates[profile.slot_id] = stored;
        }
      }
    }

    // Phase 4: resolve slot groups
    const { groups } = resolveSlotGroups(behaviorProfiles);
    const groupDisabled = new Set<string>();
    for (const [groupId, groupProfiles] of groups.entries()) {
      const groupMode = groupProfiles[0]?.group_mode ?? 'exclusive';
      switch (groupMode) {
        case 'exclusive': {
          const seed = `${state.pack_id}::${groupId}::${currentTick}`;
          const winner = resolveExclusiveGroup(groupProfiles, seed);
          for (const profile of groupProfiles) {
            if (profile.slot_id !== winner) {
              groupDisabled.add(profile.slot_id);
            }
          }
          break;
        }
        case 'priority': {
          // 按权重降序排列，render_order 越大的越靠前
          const ordered = resolvePriorityOrder(groupProfiles);
          for (let i = 0; i < ordered.length; i++) {
            ordered[i]!.render_order = ordered.length - i;
          }
          break;
        }
        case 'budget': {
          // 按权重比例分配 token 预算到 fragment metadata
          const allocations = resolveBudgetAllocation(groupProfiles, budgetResolution.effectiveBudget);
          for (const [slotId, allocation] of allocations.entries()) {
            // eslint-disable-next-line security/detect-object-injection
            const fragments = state.tree?.fragments_by_slot[slotId];
            if (!fragments) continue;
            for (const fragment of fragments) {
              fragment.metadata = {
                ...fragment.metadata,
                token_budget_allocation: allocation
              };
            }
          }
          break;
        }
      }
    }

    const diagnostics: SlotBehaviorDiagnostic = {
      profiles_evaluated: 0,
      slots_activated: [],
      slots_disabled: [],
      evaluation_errors: []
    };

    for (const profile of behaviorProfiles) {
      diagnostics.profiles_evaluated++;

      // Phase 4: group-disabled slots (lost exclusive group selection)
      if (groupDisabled.has(profile.slot_id)) {
        if (state.tree) {
          disableSlotContent(state.tree, profile.slot_id);
        }
        diagnostics.slots_disabled.push(profile.slot_id);
        continue;
      }

      try {
        const slotState = behaviorStates[profile.slot_id];
        const currentState = slotState ?? createInitialBehaviorState(profile.slot_id);

        let decision = await evaluateSlotActivation(
          profile,
          currentState,
          context,
          state,
          currentTick,
          budgetResolution.modelContextWindow
        );

        // Phase 2: apply state transitions BEFORE activation decision finalization.
        // Delayed and Cooling states override the condition-based decision.
// @ts-expect-error -- EOPT strict mode
        const nextState = applyStateTransitions(currentState, {
          conditionMet: decision.active,
          currentTick,
          stickyMaxActivations: profile.sticky?.max_activations,
          cooldownTicks: profile.cooldown?.ticks,
          delayTicks: profile.delayed_trigger?.delay_ticks
        });
        behaviorStates[profile.slot_id] = nextState;

        // Post-transition override: Delayed/Cooling → deactivate
        if (nextState.status === 'Delayed' || nextState.status === 'Cooling') {
          decision = { active: false, reason: `state transition: ${nextState.status}` };
        }

        if (!decision.active) {
          disableSlotContent(state.tree, profile.slot_id);
          diagnostics.slots_disabled.push(profile.slot_id);
        } else {
          diagnostics.slots_activated.push(profile.slot_id);
        }

        // Phase 3: apply recursion constraints on tree
        // Phase 4: mark ignore_context_length on fragments

        if (profile.ignore_context_length) {
          markIgnoreContextLength(state.tree, profile.slot_id);
          enforceIgnoreContextLengthHardLimit(state.tree, 100000);
        }
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        diagnostics.evaluation_errors.push({ slot_id: profile.slot_id, error: message });

        const policy = profile.evaluator_failure_policy ?? 'activate';
        if (policy === 'deactivate') {
          disableSlotContent(state.tree, profile.slot_id);
          diagnostics.slots_disabled.push(profile.slot_id);
        } else if (policy === 'abort') {
          const trace: PromptWorkflowStepTrace = {
            key: spec.key,
            kind: 'behavior_control',
            status: 'failed',
            before: beforeSummary,
            after: buildSummary(state),
            notes: { error: message, aborted_slot_id: profile.slot_id }
          };
          state.diagnostics.step_traces.push(trace);
          throw error;
        }
        // 'activate': keep active
      }
    }

    const trace: PromptWorkflowStepTrace = {
      key: spec.key,
      kind: 'behavior_control',
      status: 'completed',
      before: beforeSummary,
      after: buildSummary(state),
      notes: {
        profiles_evaluated: diagnostics.profiles_evaluated,
        activated: diagnostics.slots_activated.length,
        disabled: diagnostics.slots_disabled.length,
        errors: diagnostics.evaluation_errors.length,
        token_budget: budgetResolution.tokenBudget,
        effective_budget: budgetResolution.effectiveBudget,
        budget_sources: budgetResolution.sources
      }
    };
    state.diagnostics.step_traces.push(trace);

    // Phase 2: persist states back to store
    if (stateStore) {
      for (const [slotId, behaviorState] of Object.entries(behaviorStates)) {
        stateStore.setState(slotId, packId, behaviorState);
      }
    }

    return {
      ...state,
      behavior_states: behaviorStates,
      slot_behavior_diagnostics: diagnostics
    };
  }
});
