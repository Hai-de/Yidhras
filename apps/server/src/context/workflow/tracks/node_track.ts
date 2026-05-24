import { randomUUID } from 'crypto';

import type { ContextNode } from '../../../context/types.js';
import type { PromptFragmentSlot } from '../../../inference/prompt_slot_config.js';
import type {
  PromptSectionDraft,
  PromptSectionDraftType,
  PromptWorkflowTaskType,
  TrackResult
} from '../types.js';

const SUMMARY_COMPACTION_THRESHOLD = 6;
const SUMMARY_COMPACTION_KEEP = 3;

const NODE_TYPE_TO_SECTION_TYPE: Record<string, PromptSectionDraftType> = {
  recent_trace: 'recent_evidence',
  recent_event: 'recent_evidence',
  recent_intent: 'recent_evidence',
  recent_job: 'recent_evidence',
  recent_post: 'recent_evidence',
  memory_summary: 'memory_summary',
  memory_block_fact: 'memory_long_term',
  memory_block_reflection: 'memory_long_term',
  memory_block_plan: 'memory_long_term',
  manual_note: 'memory_short_term',
  overlay_self_note: 'memory_short_term',
  overlay_target_dossier: 'memory_short_term',
  overlay_system_summary: 'memory_summary',
  policy_summary: 'system_policy',
  world_state: 'world_context',
  pack_state: 'context_snapshot'
};

const inferSlot = (node: ContextNode): PromptFragmentSlot | null => {
  if (node.placement_policy.preferred_slot) {
    return node.placement_policy.preferred_slot;
  }

  const nodeType = node.node_type;

  if (nodeType.startsWith('memory_block_')) {
    return 'memory_long_term';
  }
  if (nodeType === 'memory_summary' || nodeType === 'overlay_system_summary') {
    return 'memory_summary';
  }
  if (node.source_kind === 'policy_summary') {
    return 'system_policy';
  }
  if (node.source_kind === 'world_state' || node.source_kind === 'pack_state') {
    return null;
  }

  return 'memory_short_term';
};

const nodeToSection = (node: ContextNode): PromptSectionDraft | null => {
  const slot = inferSlot(node);
  if (!slot) {
    return null;
  }

  const sectionType = NODE_TYPE_TO_SECTION_TYPE[node.node_type] ?? 'memory_short_term';

  return {
    id: `node:${node.id}`,
    track: 'node',
    section_type: sectionType,
    slot,
    priority: Math.round(node.importance * 100),
    source_node_ids: [node.id],
    content_blocks: [{ kind: 'text', text: node.content.text }],
    placement: node.placement_policy.preferred_slot
      ? {
          placement_mode: null,
          order: Math.round(node.importance * 100)
        }
      : undefined,
    removable: true,
    estimated_tokens: undefined,
    metadata: {
      tags: node.tags,
      importance: node.importance,
      salience: node.salience,
      source_kind: node.source_kind,
      node_type: node.node_type
    }
  };
};

const isNodeVisible = (node: ContextNode): boolean => {
  if (node.visibility.blocked) {
    return false;
  }
  if (node.visibility.policy_gate === 'deny') {
    return false;
  }
  if (node.visibility.read_access === 'hidden') {
    return false;
  }
  return true;
};

const compactSummaries = (
  sections: PromptSectionDraft[]
): { sections: PromptSectionDraft[]; compactedCount: number } => {
  const shortTerm = sections.filter((s) => s.slot === 'memory_short_term');
  if (shortTerm.length <= SUMMARY_COMPACTION_THRESHOLD) {
    return { sections, compactedCount: 0 };
  }

  const sorted = [...shortTerm].sort((a, b) => b.priority - a.priority);
  const kept = sorted.slice(0, SUMMARY_COMPACTION_KEEP);
  const compacted = sorted.slice(SUMMARY_COMPACTION_KEEP);

  const summaryText = compacted
    .map((s) => s.content_blocks.map((b) => (b.kind === 'text' ? b.text : '')).join(' '))
    .join(' | ');

  const summarySection: PromptSectionDraft = {
    id: randomUUID(),
    track: 'node',
    section_type: 'memory_summary',
    slot: 'memory_summary',
    priority: 130,
    source_node_ids: compacted.flatMap((s) => s.source_node_ids),
    content_blocks: [{ kind: 'text', text: `Recent memory summary: ${summaryText}` }],
    removable: true,
    metadata: {
      summarized_section_ids: compacted.map((s) => s.id),
      summarized_count: compacted.length
    }
  };

  const nonShortTerm = sections.filter((s) => s.slot !== 'memory_short_term');
  return {
    sections: [...nonShortTerm, ...kept, summarySection],
    compactedCount: compacted.length
  };
};

const groupNodes = (
  sections: PromptSectionDraft[]
): { sections: PromptSectionDraft[]; groupCount: number } => {
  const byType = new Map<string, PromptSectionDraft[]>();
  for (const section of sections) {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- metadata field from data
    const nodeType = (section.metadata?.node_type as string) ?? 'unknown';
    const existing = byType.get(nodeType);
    if (existing) {
      existing.push(section);
    } else {
      byType.set(nodeType, [section]);
    }
  }

  let groupCount = 0;
  const grouped: PromptSectionDraft[] = [];

  for (const [nodeType, group] of byType) {
    if (group.length <= 1) {
      grouped.push(...group);
      continue;
    }

    groupCount++;
    const groupText = group
      .map((s) => s.content_blocks.map((b) => (b.kind === 'text' ? b.text : '')).join(' '))
      .join('\n');

    grouped.push({
      id: randomUUID(),
      track: 'node',
      section_type: group[0].section_type,
      slot: group[0].slot,
      priority: Math.max(...group.map((s) => s.priority)),
      source_node_ids: group.flatMap((s) => s.source_node_ids),
      content_blocks: [{ kind: 'text', text: groupText }],
      removable: true,
      metadata: {
        node_group: nodeType,
        grouped_section_ids: group.map((s) => s.id),
        grouped_count: group.length
      }
    });
  }

  return { sections: grouped, groupCount };
};

export function runNodeTrack(
  nodes: ContextNode[],
  taskType: PromptWorkflowTaskType
): TrackResult<PromptSectionDraft[]> {
  const decisions: Record<string, unknown>[] = [];
  const totalNodes = nodes.length;
  let filteredOut = 0;

  // Step 1: node_working_set_filter
  const workingSet: ContextNode[] = [];
  for (const node of nodes) {
    if (!isNodeVisible(node)) {
      filteredOut++;
      decisions.push({
        decision: 'filtered',
        node_id: node.id,
        reason: node.visibility.blocked
          ? 'blocked'
          : node.visibility.policy_gate === 'deny'
            ? 'policy_gate_deny'
            : 'read_access_hidden'
      });
      continue;
    }
    workingSet.push(node);
  }

  // Step 2: memory_projection
  const projected: PromptSectionDraft[] = [];
  for (const node of workingSet) {
    const section = nodeToSection(node);
    if (section) {
      projected.push(section);
    }
  }

  // Step 3: summary_compaction
  let sections = projected;
  let compactedCount = 0;
  if (taskType === 'agent_decision') {
    const result = compactSummaries(sections);
    sections = result.sections;
    compactedCount = result.compactedCount;
    if (compactedCount > 0) {
      decisions.push({ decision: 'compacted', from_count: projected.filter((s) => s.slot === 'memory_short_term').length, to_count: sections.filter((s) => s.slot === 'memory_summary').length });
    }
  }

  // Step 4: node_grouping
  let groupCount = 0;
  if (taskType === 'memory_compaction') {
    const result = groupNodes(sections);
    sections = result.sections;
    groupCount = result.groupCount;
    if (groupCount > 0) {
      decisions.push({ decision: 'grouped', group_count: groupCount });
    }
  }

  // Build slot summary
  const bySlot: Record<string, number> = {};
  for (const section of sections) {
    bySlot[section.slot] = (bySlot[section.slot] ?? 0) + 1;
  }

  if (taskType === 'context_summary') {
    decisions.push({ decision: 'compaction_skipped', reason: 'task_type context_summary does not compact' });
  }

  return {
    result: sections,
    trace: {
      track: 'node',
      input_summary: {
        total_nodes: totalNodes,
        filtered_out: filteredOut,
        working_set_size: workingSet.length
      },
      output_summary: {
        section_drafts_count: sections.length,
        by_slot: bySlot
      },
      decisions
    }
  };
}
