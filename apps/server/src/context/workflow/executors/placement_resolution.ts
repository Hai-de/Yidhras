import type { PromptWorkflowStepExecutor } from '../registry.js';
import type {
  AnchorDiagnostic,
  PromptSectionDraft,
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

/**
 * Find the index of a target draft in the working list for anchoring.
 * Returns -1 if not found.
 */
function findAnchorTarget(
  working: PromptSectionDraft[],
  kind: string,
  value: string
): number {
  switch (kind) {
    case 'slot_start':
      return 0;
    case 'slot_end':
      return working.length - 1;
    // NOTE: 'fragment_id' matches PromptSectionDraft.id at this pipeline stage
    // (pre fragment_assembly). The naming is inherited from PromptFragmentAnchorKind.
    case 'fragment_id':
      return working.findIndex((d) => d.id === value);
    case 'source':
      return working.findIndex((d) => {
        if (d.source_node_ids.includes(value)) return true;
        const meta: Record<string, unknown> | undefined = d.metadata;
        if (meta && meta.source === value) return true;
        return false;
      });
    default:
      return -1;
  }
}

/**
 * Insert a draft into an ordered list at the position determined by its
 * placement.order (descending). Used for fallback positioning when anchor
 * resolution fails.
 */
function insertByOrder(ordered: PromptSectionDraft[], draft: PromptSectionDraft): void {
  const draftOrder = draft.placement?.order ?? 0;
  for (let i = 0; i < ordered.length; i++) {
    const wOrder = ordered[i].placement?.order ?? 0;
    if (draftOrder > wOrder) {
      ordered.splice(i, 0, draft);
      return;
    }
  }
  ordered.push(draft);
}

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
    const bySlot = new Map<string, PromptSectionDraft[]>();
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
    const anchorDiagnostics: AnchorDiagnostic[] = [];

    for (const [slotId, drafts] of bySlot) {
      const prepend: PromptSectionDraft[] = [];
      const append: PromptSectionDraft[] = [];
      const anchored: PromptSectionDraft[] = [];
      const middle: PromptSectionDraft[] = [];

      for (const draft of drafts) {
        const mode = draft.placement?.placement_mode;
        if (mode === 'prepend') {
          prepend.push(draft);
        } else if (mode === 'append') {
          append.push(draft);
        } else if (mode === 'before_anchor' || mode === 'after_anchor') {
          anchored.push(draft);
        } else {
          middle.push(draft);
        }
      }

      // Sort middle by order descending
      middle.sort((a, b) => (b.placement?.order ?? 0) - (a.placement?.order ?? 0));

      // Sort anchored by order descending for deterministic resolution
      anchored.sort((a, b) => (b.placement?.order ?? 0) - (a.placement?.order ?? 0));

      // Build the ordered list: prepend → middle(sorted) → append.
      // Anchored drafts are spliced into this list at their resolved positions.
      const ordered: PromptSectionDraft[] = [...prepend, ...middle, ...append];

      for (const draft of anchored) {
        const anchor = draft.placement?.anchor;
        const mode = draft.placement?.placement_mode;

        if (!anchor) {
          fallbackCount++;
          insertByOrder(ordered, draft);
          anchorDiagnostics.push({
            draft_id: draft.id,
            slot_id: slotId,
            anchor_kind: 'unknown',
            anchor_value: '',
            code: 'target_not_found',
            message: 'Anchor is missing; degraded to middle group'
          });
          continue;
        }

        // tag kind — scaffold only, degrade with diagnostic
        if (anchor.kind === 'tag') {
          fallbackCount++;
          insertByOrder(ordered, draft);
          anchorDiagnostics.push({
            draft_id: draft.id,
            slot_id: slotId,
            anchor_kind: 'tag',
            anchor_value: anchor.value,
            code: 'tag_not_implemented',
            message: 'tag anchor kind is not yet implemented; degraded to middle group'
          });
          continue;
        }

        // slot_start / slot_end don't require a value; fragment_id / source do
        const needsValue = anchor.kind === 'fragment_id' || anchor.kind === 'source';
        if (needsValue && !anchor.value) {
          fallbackCount++;
          insertByOrder(ordered, draft);
          anchorDiagnostics.push({
            draft_id: draft.id,
            slot_id: slotId,
            anchor_kind: anchor.kind,
            anchor_value: anchor.value,
            code: 'target_not_found',
            message: 'Anchor has no value; degraded to middle group'
          });
          continue;
        }

        const targetIdx = findAnchorTarget(ordered, anchor.kind, anchor.value ?? '');

        if (targetIdx === -1) {
          fallbackCount++;
          insertByOrder(ordered, draft);
          anchorDiagnostics.push({
            draft_id: draft.id,
            slot_id: slotId,
            anchor_kind: anchor.kind,
            anchor_value: anchor.value,
            code: 'target_not_found',
            message: `Anchor target not found in slot '${slotId}': kind=${anchor.kind}, value=${anchor.value}`
          });
          continue;
        }

        // Insert at resolved position
        if (mode === 'before_anchor') {
          ordered.splice(targetIdx, 0, draft);
        } else {
          ordered.splice(targetIdx + 1, 0, draft);
        }
        resolvedWithAnchor++;
        anchorDiagnostics.push({
          draft_id: draft.id,
          slot_id: slotId,
          anchor_kind: anchor.kind,
          anchor_value: anchor.value,
          code: 'resolved'
        });
      }

      bySlot.set(slotId, ordered);
    }

    // Flatten back: maintain slot grouping order from original array
    const placed: PromptSectionDraft[] = [];
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
      fallback_count: fallbackCount,
      anchor_diagnostics: anchorDiagnostics.length > 0 ? anchorDiagnostics : undefined
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
