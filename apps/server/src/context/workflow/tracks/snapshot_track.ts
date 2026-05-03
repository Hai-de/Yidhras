import { randomUUID } from 'crypto';

import { buildContextPromptPayload } from '../../../inference/prompt_builder.js';
import type { PromptSlotConfig } from '../../../inference/prompt_slot_config.js';
import type { InferenceContext } from '../../../inference/types.js';
import type { PromptSectionDraft, TrackResult } from '../types.js';

export function runSnapshotTrack(
  context: InferenceContext,
  slotRegistry: Record<string, PromptSlotConfig>
): TrackResult<PromptSectionDraft[]> {
  if (!slotRegistry['post_process']?.enabled) {
    return {
      result: [],
      trace: {
        track: 'snapshot',
        input_summary: { post_process_enabled: false },
        output_summary: { section_drafts_count: 0 },
        decisions: [{ decision: 'skipped', reason: 'post_process slot disabled' }]
      }
    };
  }

  const payload = buildContextPromptPayload(context);
  const section: PromptSectionDraft = {
    id: randomUUID(),
    track: 'snapshot',
    section_type: 'context_snapshot',
    slot: 'post_process',
    priority: slotRegistry['post_process']?.default_priority ?? 10,
    source_node_ids: [],
    content_blocks: [{ kind: 'json', json: payload }],
    removable: true,
    metadata: { source: 'context.snapshot' }
  };

  return {
    result: [section],
    trace: {
      track: 'snapshot',
      input_summary: { post_process_enabled: true },
      output_summary: { section_drafts_count: 1 },
      decisions: []
    }
  };
}
