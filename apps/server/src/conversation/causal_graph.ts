/**
 * Causal graph queries along ConversationEntry causal chains.
 * Operates on in-memory entries (no DB joins). Phase 2 volume is low enough
 * (hundreds of entries per memory) that application-layer filtering is acceptable.
 *
 * Design doc: .limcode/design/multi-turn-conversation-design.md §6.10
 */

import type { AgentConversationMemory, ConversationEntry } from './types.js';

// ── Index ───────────────────────────────────────────────────

interface CausalIndex {
  /** entry_id → summary entries that derive from it (forward edges) */
  forward: Map<string, ConversationEntry[]>;
  /** summary_entry_id → source entries it was derived from (backward edges) */
  backward: Map<string, ConversationEntry[]>;
}

function buildIndex(entries: ConversationEntry[]): CausalIndex {
  const forward = new Map<string, ConversationEntry[]>();
  const backward = new Map<string, ConversationEntry[]>();

  for (const entry of entries) {
    if (entry.derived_from_entry_ids && entry.derived_from_entry_ids.length > 0) {
      // Backward: from this summary → source entries
      const sources = entries.filter((e) => entry.derived_from_entry_ids!.includes(e.id));
      backward.set(entry.id, sources);

      // Forward: from each source → this summary
      for (const sourceId of entry.derived_from_entry_ids) {
        const existing = forward.get(sourceId);
        if (existing) {
          existing.push(entry);
        } else {
          forward.set(sourceId, [entry]);
        }
      }
    }
  }

  return { forward, backward };
}

// ── Causal Chain ────────────────────────────────────────────

export interface CausalChain {
  /** The entry at the center of the chain */
  root: ConversationEntry;
  /** Entries that derive from the root (forward direction) */
  derived: ConversationEntry[];
  /** Entries the root was derived from (backward direction) */
  sources: ConversationEntry[];
  /** All entries reachable via bidirectional BFS */
  all: ConversationEntry[];
}

// ── Queries ─────────────────────────────────────────────────

export class CausalGraphQuery {
  private index: CausalIndex;
  private entries: ConversationEntry[];

  constructor(memory: AgentConversationMemory) {
    this.entries = memory.entries;
    this.index = buildIndex(memory.entries);
  }

  /** Forward: which summary entries derive from the given entry? */
  getDerivedSummaries(entryId: string): ConversationEntry[] {
    return this.index.forward.get(entryId) ?? [];
  }

  /** Backward: which source entries did the given summary compress? */
  getSourceEntries(summaryEntryId: string): ConversationEntry[] {
    return this.index.backward.get(summaryEntryId) ?? [];
  }

  /** Bidirectional BFS along derived_from_entry_ids edges. */
  getCausalChain(
    entryId: string,
    opts?: { direction?: 'forward' | 'backward' | 'both'; maxDepth?: number }
  ): CausalChain {
    const direction = opts?.direction ?? 'both';
    const maxDepth = opts?.maxDepth ?? 10;

    const visited = new Set<string>();
    const queue: Array<{ id: string; depth: number }> = [{ id: entryId, depth: 0 }];
    const derived: ConversationEntry[] = [];
    const sources: ConversationEntry[] = [];

    visited.add(entryId);

    while (queue.length > 0) {
       
      const current = queue.shift()!;
      if (current.depth >= maxDepth) continue;

      // Forward traversal
      if (direction === 'forward' || direction === 'both') {
        const forwardEntries = this.index.forward.get(current.id) ?? [];
        for (const e of forwardEntries) {
          if (!visited.has(e.id)) {
            visited.add(e.id);
            derived.push(e);
            queue.push({ id: e.id, depth: current.depth + 1 });
          }
        }
      }

      // Backward traversal
      if (direction === 'backward' || direction === 'both') {
        const backwardEntries = this.index.backward.get(current.id) ?? [];
        for (const e of backwardEntries) {
          if (!visited.has(e.id)) {
            visited.add(e.id);
            sources.push(e);
            queue.push({ id: e.id, depth: current.depth + 1 });
          }
        }
      }
    }

    const all = [...derived, ...sources];

    const rootEntry = this.entries.find((e) => e.id === entryId);

    return {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- boundary type assertion
      root: rootEntry ?? ({ id: entryId } as ConversationEntry),
      derived,
      sources,
      all: rootEntry ? [rootEntry, ...all] : all
    };
  }

  /**
   * Impact analysis: given an entry, find all summaries that would be affected
   * if this entry were deleted. Traverses forward through multiple summary layers.
   */
  analyzeImpact(entryId: string): {
    affectedSummaryIds: string[];
    depth: number;
    layers: ConversationEntry[][];
  } {
    const layers: ConversationEntry[][] = [];
    const seen = new Set<string>();
    let currentLayer = this.index.forward.get(entryId) ?? [];

    while (currentLayer.length > 0 && layers.length < 10) {
      layers.push(currentLayer);
      for (const e of currentLayer) {
        seen.add(e.id);
      }

      const nextLayer: ConversationEntry[] = [];
      for (const e of currentLayer) {
        const derived = this.index.forward.get(e.id) ?? [];
        for (const d of derived) {
          if (!seen.has(d.id)) {
            nextLayer.push(d);
          }
        }
      }
      currentLayer = nextLayer;
    }

    return {
      affectedSummaryIds: layers.flat().map((e) => e.id),
      depth: layers.length,
      layers
    };
  }
}
