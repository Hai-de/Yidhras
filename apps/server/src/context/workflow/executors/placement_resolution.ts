import type { PromptWorkflowStepExecutor } from '../registry.js';
import type {
  PromptWorkflowPlacementSummary,
  PromptWorkflowState,
  PromptWorkflowStepTrace,
  StepSnapshotSummary
} from '../types.js';

const emptySummary = (state: PromptWorkflowState): StepSnapshotSummary => ({
  section_drafts_count: state.section_drafts.length,
  fragment_count: 0,
  total_estimated_tokens: 0,
  denied_fragment_count: 0,
  working_set_node_count: state.working_set.length
});

export const createPlacementResolutionExecutor = (): PromptWorkflowStepExecutor => ({
  kind: 'placement_resolution',
  // eslint-disable-next-line @typescript-eslint/require-await
  async execute({ state, spec }) {
    const beforeSummary = emptySummary(state);

    if (state.section_drafts.length === 0) {
      const trace: PromptWorkflowStepTrace = {
        key: spec.key,
        kind: 'placement_resolution',
        status: 'completed',
        before: beforeSummary,
        after: emptySummary(state),
        notes: { skipped: true, reason: 'no section_drafts to place' }
      };
      state.diagnostics.step_traces.push(trace);
      return state;
    }

    // Group by slot
    const bySlot = new Map<string, typeof state.section_drafts>();
    for (const draft of state.section_drafts) {
      const existing = bySlot.get(draft.slot);
      if (existing) {
        existing.push(draft);
      } else {
        bySlot.set(draft.slot, [draft]);
      }
    }

    let resolvedWithAnchor = 0;
    let fallbackCount = 0;

    for (const [slotId, drafts] of bySlot) {
      const prepend: typeof drafts = [];
      const append: typeof drafts = [];
      const middle: typeof drafts = [];

      for (const draft of drafts) {
        const mode = draft.placement?.placement_mode;
        if (mode === 'prepend') {
          prepend.push(draft);
        } else if (mode === 'append') {
          append.push(draft);
        } else if (mode === 'before_anchor' || mode === 'after_anchor') {
          const anchor = draft.placement?.anchor;
          if (anchor?.value) {
            resolvedWithAnchor++;
            middle.push(draft);
          } else {
            fallbackCount++;
            middle.push(draft);
          }
        } else {
          middle.push(draft);
        }
      }

      // Sort middle by priority descending
      middle.sort((a, b) => (b.placement?.order ?? 0) - (a.placement?.order ?? 0));

      // Rebuild slot array: prepend → middle → append
      bySlot.set(slotId, [...prepend, ...middle, ...append]);
    }

    // Flatten back: maintain slot grouping order from original array
    const placed: typeof state.section_drafts = [];
    const processedSlots = new Set<string>();
    for (const draft of state.section_drafts) {
      if (!processedSlots.has(draft.slot)) {
        processedSlots.add(draft.slot);
        const slotDrafts = bySlot.get(draft.slot);
        if (slotDrafts) {
          placed.push(...slotDrafts);
        }
      }
    }

    state.section_drafts = placed;

    const placementSummary: PromptWorkflowPlacementSummary = {
      total_fragments: state.section_drafts.length,
      resolved_with_anchor: resolvedWithAnchor,
      fallback_count: fallbackCount
    };
    state.diagnostics.placement_summary = placementSummary;

    const trace: PromptWorkflowStepTrace = {
      key: spec.key,
      kind: 'placement_resolution',
      status: 'completed',
      before: beforeSummary,
      after: emptySummary(state),
      notes: { placementSummary }
    };
    state.diagnostics.step_traces.push(trace);

    return state;
  }
});
