import type { MemoryContextPack, MemoryDroppedEntry, MemoryEntry, MemorySelectionResult } from './types.js';

export interface SelectMemoryInput {
  short_term: MemoryEntry[];
  long_term: MemoryEntry[];
  summaries?: MemoryEntry[];
  short_term_limit?: number;
  long_term_limit?: number;
}

const scoreEntry = (entry: MemoryEntry): number => {
  return entry.importance * 100 + entry.salience * 10;
};

const sortEntries = (entries: MemoryEntry[]): MemoryEntry[] => {
  return [...entries].sort((left, right) => {
    const scoreDiff = scoreEntry(right) - scoreEntry(left);
    if (scoreDiff !== 0) {
      return scoreDiff;
    }

    return right.created_at.localeCompare(left.created_at);
  });
};

const takeWithDropped = (
  entries: MemoryEntry[],
  limit: number,
  reason: string
): { kept: MemoryEntry[]; dropped: MemoryDroppedEntry[] } => {
  if (entries.length <= limit) {
    return {
      kept: entries,
      dropped: []
    };
  }

  return {
    kept: entries.slice(0, limit),
    dropped: entries.slice(limit).map(entry => ({
      entry_id: entry.id,
      reason
    }))
  };
};

export const selectMemory = (input: SelectMemoryInput): MemorySelectionResult => {
  const shortTermSorted = sortEntries(input.short_term);
  const longTermSorted = sortEntries(input.long_term);
  const summaries = sortEntries(input.summaries ?? []);

  const shortTermSelection = takeWithDropped(
    shortTermSorted,
    input.short_term_limit ?? 8,
    'short_term_limit_exceeded'
  );
  const longTermSelection = takeWithDropped(
    longTermSorted,
    input.long_term_limit ?? 4,
    'long_term_limit_exceeded'
  );

  const dropped = [...shortTermSelection.dropped, ...longTermSelection.dropped];

  return {
    short_term: shortTermSelection.kept,
    long_term: longTermSelection.kept,
    summaries,
    dropped,
    diagnostics: {
      selected_count: shortTermSelection.kept.length + longTermSelection.kept.length + summaries.length,
      skipped_count: dropped.length,
      memory_selection: {
        selected_entry_ids: [...shortTermSelection.kept, ...longTermSelection.kept, ...summaries].map(entry => entry.id),
        dropped
      }
    }
  };
};

export const toMemoryContextPack = (selection: MemorySelectionResult): MemoryContextPack => {
  return {
    short_term: selection.short_term,
    long_term: selection.long_term,
    summaries: selection.summaries,
    diagnostics: selection.diagnostics
  };
};
