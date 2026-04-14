import type { PromptFragment, PromptFragmentSlot } from '../../inference/prompt_fragments.js';

export interface PromptWorkflowPlacementDecision {
  fragment_id: string;
  resolved_slot: PromptFragmentSlot;
  anchor_key: string | null;
  placement_mode: PromptFragment['placement_mode'] | null;
  resolved_index: number;
  matched_fragment_ids?: string[];
  fallback_reason?: string | null;
}

export interface PromptWorkflowPlacementSummary {
  total_fragments: number;
  resolved_with_anchor: number;
  fallback_count: number;
}

export interface PromptWorkflowPlacementResult {
  fragments: PromptFragment[];
  decisions: PromptWorkflowPlacementDecision[];
  summary: PromptWorkflowPlacementSummary;
}

const getAnchorKey = (fragment: PromptFragment): string => {
  if (!fragment.anchor || typeof fragment.anchor !== 'object') {
    return '';
  }

  return `${fragment.anchor.kind}:${fragment.anchor.value}`;
};

const getDepth = (fragment: PromptFragment): number => {
  return typeof fragment.depth === 'number' && Number.isFinite(fragment.depth) ? fragment.depth : 0;
};

const getOrder = (fragment: PromptFragment): number => {
  return typeof fragment.order === 'number' && Number.isFinite(fragment.order) ? fragment.order : 0;
};

const getPriority = (fragment: PromptFragment): number => {
  return typeof fragment.priority === 'number' && Number.isFinite(fragment.priority) ? fragment.priority : 0;
};

const getSlotOrderIndex = (
  slot: PromptFragmentSlot,
  slotOrderMap: Map<PromptFragmentSlot, number>
): number => {
  return slotOrderMap.get(slot) ?? Number.MAX_SAFE_INTEGER;
};

const compareBase = (left: PromptFragment, right: PromptFragment): number => {
  const anchorDiff = getAnchorKey(left).localeCompare(getAnchorKey(right));
  if (anchorDiff !== 0) {
    return anchorDiff;
  }

  const depthDiff = getDepth(left) - getDepth(right);
  if (depthDiff !== 0) {
    return depthDiff;
  }

  const orderDiff = getOrder(left) - getOrder(right);
  if (orderDiff !== 0) {
    return orderDiff;
  }

  const priorityDiff = getPriority(right) - getPriority(left);
  if (priorityDiff !== 0) {
    return priorityDiff;
  }

  return left.id.localeCompare(right.id);
};

const sortBase = (fragments: PromptFragment[], slotOrder?: PromptFragmentSlot[]): PromptFragment[] => {
  const slotOrderMap = new Map((slotOrder ?? []).map((slot, index) => [slot, index]));
  return [...fragments].sort((left, right) => {
    if (slotOrderMap.size > 0) {
      const slotOrderDiff = getSlotOrderIndex(left.slot, slotOrderMap) - getSlotOrderIndex(right.slot, slotOrderMap);
      if (slotOrderDiff !== 0) {
        return slotOrderDiff;
      }
    }

    if (left.slot !== right.slot) {
      return left.slot.localeCompare(right.slot);
    }

    return compareBase(left, right);
  });
};

const getFragmentTags = (fragment: PromptFragment): string[] => {
  if (!Array.isArray(fragment.metadata?.tags)) {
    return [];
  }

  return fragment.metadata.tags.filter((value): value is string => typeof value === 'string');
};

const resolveAnchorTargets = (
  fragment: PromptFragment,
  placed: PromptFragment[]
): PromptFragment[] => {
  if (!fragment.anchor) {
    return [];
  }

  switch (fragment.anchor.kind) {
    case 'fragment_id':
      return placed.filter(candidate => candidate.id === fragment.anchor?.value);
    case 'source':
      return placed.filter(candidate => candidate.source === fragment.anchor?.value);
    case 'tag':
      return placed.filter(candidate => getFragmentTags(candidate).includes(fragment.anchor?.value ?? ''));
    default:
      return [];
  }
};

const isFrontPlacement = (fragment: PromptFragment): boolean => {
  return fragment.placement_mode === 'prepend' ||
    (fragment.placement_mode === 'before_anchor' && fragment.anchor?.kind === 'slot_start');
};

const isBackPlacement = (fragment: PromptFragment): boolean => {
  return !fragment.placement_mode ||
    fragment.placement_mode === 'append' ||
    (fragment.placement_mode === 'after_anchor' && fragment.anchor?.kind === 'slot_end');
};

const insertAt = (list: PromptFragment[], fragment: PromptFragment, index: number): number => {
  const normalizedIndex = Math.max(0, Math.min(index, list.length));
  list.splice(normalizedIndex, 0, fragment);
  return normalizedIndex;
};

const resolveSlotPlacement = (fragments: PromptFragment[]): {
  fragments: PromptFragment[];
  decisions: PromptWorkflowPlacementDecision[];
} => {
  const ordered = sortBase(fragments);
  const front = ordered.filter(isFrontPlacement);
  const back = ordered.filter(fragment => !isFrontPlacement(fragment) && isBackPlacement(fragment));
  const pending = ordered.filter(fragment => !isFrontPlacement(fragment) && !isBackPlacement(fragment));
  const placed = [...front, ...back];
  const resolutionMeta = new Map<
    string,
    {
      matched_fragment_ids?: string[];
      fallback_reason?: string | null;
    }
  >();

  while (pending.length > 0) {
    let progressed = false;

    for (let index = 0; index < pending.length; index += 1) {
      const fragment = pending[index]!;

      if (fragment.anchor?.kind === 'slot_start' && fragment.placement_mode === 'after_anchor') {
        insertAt(placed, fragment, Math.min(1, placed.length));
        resolutionMeta.set(fragment.id, { matched_fragment_ids: [] });
        pending.splice(index, 1);
        index -= 1;
        progressed = true;
        continue;
      }

      if (fragment.anchor?.kind === 'slot_end' && fragment.placement_mode === 'before_anchor') {
        insertAt(placed, fragment, Math.max(placed.length - 1, 0));
        resolutionMeta.set(fragment.id, { matched_fragment_ids: [] });
        pending.splice(index, 1);
        index -= 1;
        progressed = true;
        continue;
      }

      const matchedTargets = resolveAnchorTargets(fragment, placed);
      if (matchedTargets.length === 0) {
        continue;
      }

      const target = matchedTargets[0]!;
      const targetIndex = placed.findIndex(candidate => candidate.id === target.id);
      if (targetIndex < 0) {
        continue;
      }

      const insertionIndex = fragment.placement_mode === 'before_anchor' ? targetIndex : targetIndex + 1;
      insertAt(placed, fragment, insertionIndex);
      resolutionMeta.set(fragment.id, {
        matched_fragment_ids: matchedTargets.map(candidate => candidate.id)
      });
      pending.splice(index, 1);
      index -= 1;
      progressed = true;
    }

    if (progressed) {
      continue;
    }

    while (pending.length > 0) {
      const fragment = pending.shift()!;
      if (fragment.placement_mode === 'before_anchor') {
        insertAt(placed, fragment, 0);
      } else {
        insertAt(placed, fragment, placed.length);
      }
      resolutionMeta.set(fragment.id, {
        fallback_reason: 'anchor_not_found'
      });
    }
  }

  const decisions: PromptWorkflowPlacementDecision[] = placed.map((fragment, index) => {
    const meta = resolutionMeta.get(fragment.id);
    return {
      fragment_id: fragment.id,
      resolved_slot: fragment.slot,
      anchor_key: fragment.anchor ? `${fragment.anchor.kind}:${fragment.anchor.value}` : null,
      placement_mode: fragment.placement_mode ?? null,
      resolved_index: index,
      matched_fragment_ids: meta?.matched_fragment_ids,
      fallback_reason: meta?.fallback_reason ?? null
    };
  });

  return {
    fragments: placed,
    decisions
  };
};

export const sortPromptFragmentsBase = (
  fragments: PromptFragment[],
  slotOrder?: PromptFragmentSlot[]
): PromptFragment[] => {
  return sortBase(fragments, slotOrder);
};

export const resolvePromptFragmentPlacement = (input: {
  fragments: PromptFragment[];
  slotOrder?: PromptFragmentSlot[];
}): PromptWorkflowPlacementResult => {
  const ordered = sortBase(input.fragments, input.slotOrder);
  const slotOrder = input.slotOrder ?? Array.from(new Set(ordered.map(fragment => fragment.slot)));
  const slotBuckets = new Map<PromptFragmentSlot, PromptFragment[]>();

  for (const fragment of ordered) {
    const bucket = slotBuckets.get(fragment.slot);
    if (bucket) {
      bucket.push(fragment);
    } else {
      slotBuckets.set(fragment.slot, [fragment]);
    }
  }

  const resolvedFragments: PromptFragment[] = [];
  const decisions: PromptWorkflowPlacementDecision[] = [];

  for (const slot of slotOrder) {
    const bucket = slotBuckets.get(slot);
    if (!bucket || bucket.length === 0) {
      continue;
    }

    const resolved = resolveSlotPlacement(bucket);
    resolvedFragments.push(...resolved.fragments);
    decisions.push(...resolved.decisions);
  }

  for (const [slot, bucket] of slotBuckets.entries()) {
    if (slotOrder.includes(slot)) {
      continue;
    }

    const resolved = resolveSlotPlacement(bucket);
    resolvedFragments.push(...resolved.fragments);
    decisions.push(...resolved.decisions);
  }

  const summary: PromptWorkflowPlacementSummary = {
    total_fragments: resolvedFragments.length,
    resolved_with_anchor: decisions.filter(decision => decision.anchor_key !== null && !decision.fallback_reason).length,
    fallback_count: decisions.filter(decision => Boolean(decision.fallback_reason)).length
  };

  return {
    fragments: resolvedFragments,
    decisions,
    summary
  };
};
