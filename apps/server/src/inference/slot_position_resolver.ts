import type {
  PromptSlotConfig,
  ResolvedSlotPosition,
  SlotPositionDiagnostics
} from '../inference/prompt_slot_config.js';

/**
 * Compute the insert position for an anchored slot between lo and hi bounds.
 * Exported for unit testing.
 */
export const allocatePosition = (
  occupiedPositions: Set<number>,
  refPosition: number,
  relation: 'after' | 'before',
  sortedDescending: number[]
): number => {
  const refIndex = sortedDescending.indexOf(refPosition);

  let lo: number;
  let hi: number;

  if (relation === 'after') {
    // "排在 ref 之后" = between ref and the next lower position
    const nextPosition = sortedDescending[refIndex + 1] ?? 0;
    lo = nextPosition;
    hi = refPosition;
  } else {
    // "排在 ref 之前" = between ref and the next higher position
    const prevPosition = sortedDescending[refIndex - 1] ?? refPosition + 10;
    lo = refPosition;
    hi = prevPosition;
  }

  const gap = hi - lo;

  if (gap < 1) {
    // Linear probing: search for first empty slot from lo upward with 0.01 step
    let probe = lo + 0.01;
    while (occupiedPositions.has(probe) && probe < hi) {
      probe += 0.01;
    }
    return probe < hi ? probe : (lo + hi) / 2;
  }

  return (lo + hi) / 2;
};

/**
 * Resolve slot positions from a flat record of slot configs.
 *
 * Pure function — no side effects beyond the returned result.
 * Disabled slots (enabled=false) are retained in the result
 * so they remain valid anchor targets.
 */
export const resolveSlotPositions = (
  configs: Record<string, PromptSlotConfig>
): { resolved_positions: ResolvedSlotPosition[]; diagnostics: SlotPositionDiagnostics } => {
  const diagnostics: SlotPositionDiagnostics = { warnings: [], resolution_map: [] };
  const entries = Object.entries(configs);

  if (entries.length === 0) {
    return { resolved_positions: [], diagnostics };
  }

  // ── Step 1: classify slots ──
  const positionMap = new Map<string, number>();
  const resolutionSource = new Map<string, ResolvedSlotPosition['resolution_source']>();
  const anchored = new Map<string, { ref: string; relation: 'after' | 'before' }>();

  for (const [slotId, config] of entries) {
    if (config.anchor?.ref && config.anchor?.relation) {
      anchored.set(slotId, { ref: config.anchor.ref, relation: config.anchor.relation });
    } else {
      const pos = config.position ?? config.default_priority;
      positionMap.set(slotId, pos);
      resolutionSource.set(slotId, config.position !== undefined && config.position !== null ? 'explicit' : 'default');
    }
  }

  // ── Step 2: cycle detection (DFS on anchored → ref graph) ──
  const cycleNodes = new Set<string>();
  const WHITE = 0;
  const GRAY = 1;
  const BLACK = 2;
  const color = new Map<string, number>();

  for (const slotId of anchored.keys()) {
    color.set(slotId, WHITE);
  }

  const dfs = (node: string, path: string[]): boolean => {
    const c = color.get(node);
    if (c === BLACK) return false;
    if (c === GRAY) {
      // Cycle found — mark every node on the current path + this node
      for (const n of path) cycleNodes.add(n);
      cycleNodes.add(node);
      return true;
    }
    color.set(node, GRAY);
    path.push(node);
    const anchor = anchored.get(node);
    if (anchor && anchored.has(anchor.ref)) {
      dfs(anchor.ref, path);
    }
    path.pop();
    color.set(node, BLACK);
    return false;
  };

  for (const slotId of anchored.keys()) {
    if (color.get(slotId) === WHITE) {
      dfs(slotId, []);
    }
  }

  // ── Step 3: immediate fallback for missing refs ──
  const unresolvedAnchors = new Map<string, { ref: string; relation: 'after' | 'before' }>();

  for (const [slotId, anchor] of anchored) {
    if (cycleNodes.has(slotId)) continue;

    if (!(anchor.ref in configs)) {
      const config = configs[slotId];
      const fallback = config.position ?? config.default_priority;
      diagnostics.warnings.push({
        slot_id: slotId,
        code: 'anchor_ref_not_found',
        message: `Anchor ref '${anchor.ref}' not found in slot registry`,
        fallback_position: fallback
      });
      positionMap.set(slotId, fallback);
      resolutionSource.set(slotId, 'default');
    } else {
      unresolvedAnchors.set(slotId, anchor);
    }
  }

  // ── Step 4: iterative topological resolution ──
  let progress = true;
  while (unresolvedAnchors.size > 0 && progress) {
    progress = false;
    for (const [slotId, anchor] of [...unresolvedAnchors]) {
      const refPosition = positionMap.get(anchor.ref);
      if (refPosition !== undefined) {
        const uniquePositions = [...new Set(positionMap.values())].sort((a, b) => b - a);
        const occupied = new Set(uniquePositions);
        const pos = allocatePosition(occupied, refPosition, anchor.relation, uniquePositions);
        positionMap.set(slotId, pos);
        resolutionSource.set(slotId, 'anchor');
        unresolvedAnchors.delete(slotId);
        progress = true;
      }
    }
  }

  // ── Step 5: fallback for cycles + unresolved ──
  for (const slotId of cycleNodes) {
    const config = configs[slotId];
    const fallback = config.position ?? config.default_priority;
    diagnostics.warnings.push({
      slot_id: slotId,
      code: 'anchor_cycle_detected',
      message: `Anchor cycle detected for '${slotId}'`,
      fallback_position: fallback
    });
    positionMap.set(slotId, fallback);
    resolutionSource.set(slotId, 'default');
  }

  for (const [slotId] of unresolvedAnchors) {
    const config = configs[slotId];
    const fallback = config.position ?? config.default_priority;
    diagnostics.warnings.push({
      slot_id: slotId,
      code: 'anchor_cycle_detected',
      message: `Could not resolve anchor for '${slotId}': dependency chain blocked`,
      fallback_position: fallback
    });
    positionMap.set(slotId, fallback);
    resolutionSource.set(slotId, 'default');
  }

  // ── Step 6: collision detection & final sort ──
  const positionGroups = new Map<number, string[]>();
  for (const [slotId, pos] of positionMap) {
    const group = positionGroups.get(pos);
    if (group) {
      group.push(slotId);
    } else {
      positionGroups.set(pos, [slotId]);
    }
  }

  for (const [pos, slotIds] of positionGroups) {
    if (slotIds.length > 1) {
      for (const slotId of slotIds) {
        diagnostics.warnings.push({
          slot_id: slotId,
          code: 'position_collision',
          message: `Position ${pos} collision with: ${slotIds.filter(id => id !== slotId).join(', ')}`,
          fallback_position: pos
        });
      }
    }
  }

  // Resolve collisions: stable sort by slot_id within same position
  const sorted = [...positionMap.entries()]
    .sort((a, b) => {
      const posDiff = b[1] - a[1]; // descending
      if (posDiff !== 0) return posDiff;
      return a[0].localeCompare(b[0]); // stable by slot_id
    });

  const resolved_positions: ResolvedSlotPosition[] = sorted.map(([slotId, resolved_position]) => ({
    slot_id: slotId,
    resolved_position,
    resolution_source: resolutionSource.get(slotId) ?? 'default',
    enabled: configs[slotId]?.enabled ?? true
  }));

  diagnostics.resolution_map = resolved_positions.map(r => ({
    slot_id: r.slot_id,
    resolved_position: r.resolved_position,
    source: r.resolution_source
  }));

  return { resolved_positions, diagnostics };
};
