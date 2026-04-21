import { randomUUID } from 'node:crypto';

import type { AppContext } from '../../app/context.js';
import { createContextOverlayStore } from '../../context/overlay/store.js';
import type { ContextOverlayEntry, ContextOverlayStore, ContextOverlayType } from '../../context/overlay/types.js';
import type { ContextMemoryBlockMutationRecord, ContextOverlayMutationRecord } from '../../context/types.js';
import type { InferenceMemoryMutationRecord, InferenceMemoryMutationSnapshot } from '../../inference/types.js';
import { createPrismaLongMemoryBlockStore } from '../blocks/store.js';
import type { LongMemoryBlockStore, MemoryBehavior, MemoryBlock, MemoryBlockKind, MemoryBlockRecord } from '../blocks/types.js';
import { upsertDeclaredPackCollectionRecord } from '../../packs/storage/pack_collection_repo.js';

const toNullableString = (value: unknown): string | null => {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
};

const mergeTags = (...inputs: Array<string[] | undefined>): string[] => {
  return Array.from(new Set(inputs.flatMap(values => values ?? []).map(value => value.trim()).filter(Boolean)));
};

const buildDefaultMemoryBehavior = (kind: MemoryBlockKind): MemoryBehavior => ({
  mutation: {
    allow_insert: true,
    allow_rewrite: true,
    allow_delete: true
  },
  placement: {
    slot: kind === 'summary' ? 'memory_summary' : 'memory_long_term',
    anchor: null,
    mode: 'append',
    depth: 0,
    order: 0
  },
  activation: {
    mode: 'always',
    trigger_rate: 1,
    min_score: 0,
    triggers: []
  },
  retention: {
    retain_rounds_after_trigger: 2,
    cooldown_rounds_after_insert: 0,
    delay_rounds_before_insert: 0
  }
});

const toOverlayMutationRecord = (
  entry: ContextOverlayEntry,
  operation: ContextOverlayMutationRecord['operation']
): ContextOverlayMutationRecord => ({
  overlay_id: entry.id,
  operation,
  node_id: entry.id,
  status: entry.status
});

const toMemoryBlockMutationRecord = (
  block: MemoryBlock,
  operation: ContextMemoryBlockMutationRecord['operation']
): ContextMemoryBlockMutationRecord => ({
  memory_id: block.id,
  operation,
  kind: block.kind,
  status: block.status,
  source_kind: toNullableString(block.source_ref?.source_kind)
});

const toInferenceMutationRecordFromOverlay = (
  entry: ContextOverlayEntry,
  operation: InferenceMemoryMutationRecord['operation']
): InferenceMemoryMutationRecord => ({
  kind: 'overlay',
  record_id: entry.id,
  operation,
  actor_id: entry.actor_id,
  pack_id: entry.pack_id,
  note_kind: entry.overlay_type,
  status: entry.status,
  metadata: entry.content_structured
});

const toInferenceMutationRecordFromMemoryBlock = (
  block: MemoryBlock,
  operation: InferenceMemoryMutationRecord['operation']
): InferenceMemoryMutationRecord => ({
  kind: 'memory_block',
  record_id: block.id,
  operation,
  actor_id: block.owner_agent_id,
  pack_id: block.pack_id,
  note_kind: block.kind,
  status: block.status,
  metadata: block.content_structured
});

export interface MemoryRecordingMutationBundle {
  overlay_mutations: ContextOverlayMutationRecord[];
  memory_block_mutations: ContextMemoryBlockMutationRecord[];
  trace_memory_mutations: InferenceMemoryMutationSnapshot;
}

export interface DecisionReflectionInput {
  actor_id: string;
  pack_id: string;
  tick: string;
  source_inference_id: string;
  reasoning: string | null | undefined;
  semantic_intent_kind?: string | null;
  target_ref?: Record<string, unknown> | null;
  existing_overlay_id?: string | null;
  tags?: string[];
  metadata?: Record<string, unknown> | null;
}

export interface ExecutionReflectionInput {
  actor_id: string;
  pack_id: string;
  tick: string;
  source_inference_id: string;
  source_action_intent_id: string;
  intent_type: string;
  outcome: 'completed' | 'failed' | 'dropped';
  reason?: string | null;
  target_ref?: Record<string, unknown> | null;
  semantic_intent_kind?: string | null;
  event_summaries?: Array<{ id: string; type: string; title: string }>;
  metadata?: Record<string, unknown> | null;
}

export interface MemoryRecordingService {
  recordDecisionReflection(input: DecisionReflectionInput): Promise<MemoryRecordingMutationBundle>;
  recordExecutionReflection(input: ExecutionReflectionInput): Promise<MemoryRecordingMutationBundle>;
  recordPrivateReflection(input: DecisionReflectionInput): Promise<MemoryRecordingMutationBundle>;
  reviseJudgementPlan(input: DecisionReflectionInput): Promise<MemoryRecordingMutationBundle>;
  updateTargetDossier(input: DecisionReflectionInput): Promise<MemoryRecordingMutationBundle>;
}

export interface CreateMemoryRecordingServiceOptions {
  context: AppContext;
  overlayStore?: ContextOverlayStore;
  longMemoryBlockStore?: LongMemoryBlockStore;
}

const emptyMutationBundle = (): MemoryRecordingMutationBundle => ({
  overlay_mutations: [],
  memory_block_mutations: [],
  trace_memory_mutations: {
    records: []
  }
});

const buildOverlayStructuredContent = (input: {
  record_kind: string;
  source_inference_id: string;
  semantic_intent_kind?: string | null;
  source_action_intent_id?: string | null;
  target_ref?: Record<string, unknown> | null;
  metadata?: Record<string, unknown> | null;
}): Record<string, unknown> => ({
  record_kind: input.record_kind,
  source_inference_id: input.source_inference_id,
  semantic_intent_kind: input.semantic_intent_kind ?? null,
  source_action_intent_id: input.source_action_intent_id ?? null,
  target_ref: input.target_ref ?? null,
  ...(input.metadata ? { metadata: input.metadata } : {})
});

const buildDecisionReflectionText = (input: DecisionReflectionInput): string | null => {
  const reasoning = toNullableString(input.reasoning);
  if (!reasoning) {
    return null;
  }

  return reasoning;
};

const buildExecutionReflectionText = (input: ExecutionReflectionInput): string => {
  const reason = toNullableString(input.reason);
  const eventTitles = (input.event_summaries ?? []).map(item => item.title).filter(Boolean);
  return [
    `执行结果：${input.outcome}`,
    reason ? `原因：${reason}` : null,
    eventTitles.length > 0 ? `关联事件：${eventTitles.join('；')}` : null
  ].filter((item): item is string => typeof item === 'string' && item.trim().length > 0).join('\n');
};

const buildExecutionReflectionSummary = (input: ExecutionReflectionInput): Record<string, unknown> => ({
  source_action_intent_id: input.source_action_intent_id,
  source_inference_id: input.source_inference_id,
  intent_type: input.intent_type,
  outcome: input.outcome,
  reason: input.reason ?? null,
  target_ref: input.target_ref ?? null,
  semantic_intent_kind: input.semantic_intent_kind ?? null,
  event_summaries: input.event_summaries ?? [],
  ...(input.metadata ? { metadata: input.metadata } : {})
});

const buildMemoryBlockInput = (input: {
  actor_id: string;
  pack_id: string;
  tick: string;
  kind: MemoryBlockKind;
  title: string | null;
  content_text: string;
  content_structured: Record<string, unknown> | null;
  tags: string[];
  keywords: string[];
  source_ref: MemoryBlock['source_ref'];
}): { block: MemoryBlock; behavior: MemoryBehavior } => ({
  block: {
    id: randomUUID(),
    owner_agent_id: input.actor_id,
    pack_id: input.pack_id,
    kind: input.kind,
    status: 'active',
    title: input.title,
    content_text: input.content_text,
    content_structured: input.content_structured,
    tags: input.tags,
    keywords: input.keywords,
    source_ref: input.source_ref,
    importance: input.kind === 'reflection' ? 0.82 : 0.75,
    salience: input.kind === 'reflection' ? 0.8 : 0.72,
    confidence: null,
    created_at_tick: input.tick,
    updated_at_tick: input.tick
  },
  behavior: buildDefaultMemoryBehavior(input.kind)
});

export const createMemoryRecordingService = ({
  context,
  overlayStore = createContextOverlayStore(context),
  longMemoryBlockStore = createPrismaLongMemoryBlockStore(context)
}: CreateMemoryRecordingServiceOptions): MemoryRecordingService => {
  return {
    async recordPrivateReflection(input) {
      return this.recordDecisionReflection({
        ...input,
        target_ref: null,
        tags: mergeTags(input.tags, ['record_private_reflection']),
        metadata: {
          ...(input.metadata ?? {}),
          record_kind: 'record_private_reflection'
        }
      });
    },

    async reviseJudgementPlan(input) {
      const reasoning = buildDecisionReflectionText(input);
      if (!reasoning) {
        return emptyMutationBundle();
      }

      const overlayEntry = await overlayStore.createEntry({
        actor_id: input.actor_id,
        pack_id: input.pack_id,
        overlay_type: 'self_note',
        title: `计划修订 @ ${input.tick}`,
        content_text: reasoning,
        content_structured: buildOverlayStructuredContent({
          record_kind: 'revise_judgement_plan',
          source_inference_id: input.source_inference_id,
          semantic_intent_kind: input.semantic_intent_kind ?? null,
          target_ref: input.target_ref ?? null,
          metadata: input.metadata ?? null
        }),
        tags: mergeTags(
          ['memory_record', 'judgement_plan', 'plan_revision'],
          input.semantic_intent_kind ? [`semantic:${input.semantic_intent_kind}`] : [],
          input.tags
        ),
        created_by: 'system',
        persistence_mode: 'persistent',
        created_at_tick: input.tick,
        updated_at_tick: input.tick
      });

      await upsertDeclaredPackCollectionRecord(input.pack_id, 'judgement_plans', {
        id: overlayEntry.id,
        owner_actor_id: input.actor_id,
        target_entity_id: typeof input.target_ref?.entity_id === 'string' ? input.target_ref.entity_id : null,
        phase: typeof input.metadata?.phase === 'string' ? input.metadata.phase : input.semantic_intent_kind ?? 'revise_judgement_plan',
        risk_score: typeof input.metadata?.risk_score === 'number' ? input.metadata.risk_score : null,
        content: buildOverlayStructuredContent({
          record_kind: 'revise_judgement_plan',
          source_inference_id: input.source_inference_id,
          semantic_intent_kind: input.semantic_intent_kind ?? null,
          target_ref: input.target_ref ?? null,
          metadata: { reasoning, ...(input.metadata ?? {}) }
        })
      });

      const memoryRecord = await longMemoryBlockStore.upsertBlock(buildMemoryBlockInput({
        actor_id: input.actor_id,
        pack_id: input.pack_id,
        tick: input.tick,
        kind: 'plan',
        title: `执行计划修订 ${input.tick}`,
        content_text: reasoning,
        content_structured: buildOverlayStructuredContent({
          record_kind: 'revise_judgement_plan',
          source_inference_id: input.source_inference_id,
          semantic_intent_kind: input.semantic_intent_kind ?? null,
          target_ref: input.target_ref ?? null,
          metadata: input.metadata ?? null
        }),
        tags: mergeTags(
          ['memory_record', 'judgement_plan', 'plan_revision'],
          input.semantic_intent_kind ? [`semantic:${input.semantic_intent_kind}`] : [],
          input.tags
        ),
        keywords: mergeTags(['judgement_plan', 'plan_revision'], input.semantic_intent_kind ? [input.semantic_intent_kind] : []),
        source_ref: { source_kind: 'overlay', source_id: overlayEntry.id }
      }));

      return {
        overlay_mutations: [toOverlayMutationRecord(overlayEntry, 'created')],
        memory_block_mutations: [toMemoryBlockMutationRecord(memoryRecord.block, 'created')],
        trace_memory_mutations: {
          records: [
            toInferenceMutationRecordFromOverlay(overlayEntry, 'created'),
            toInferenceMutationRecordFromMemoryBlock(memoryRecord.block, 'created')
          ]
        }
      };
    },

    async updateTargetDossier(input) {
      return this.recordDecisionReflection({
        ...input,
        tags: mergeTags(input.tags, ['update_target_dossier']),
        metadata: {
          ...(input.metadata ?? {}),
          record_kind: 'update_target_dossier'
        }
      });
    },

    async recordDecisionReflection(input) {
      const reasoning = buildDecisionReflectionText(input);
      if (!reasoning) {
        return emptyMutationBundle();
      }

      const overlayType: ContextOverlayType = input.target_ref ? 'target_dossier' : 'self_note';
      const title = overlayType === 'target_dossier'
        ? `目标档案更新 @ ${input.tick}`
        : `思考记录 @ ${input.tick}`;
      const structured = buildOverlayStructuredContent({
        record_kind: typeof input.metadata?.record_kind === 'string'
          ? input.metadata.record_kind
          : overlayType === 'target_dossier' ? 'target_dossier_update' : 'decision_reflection',
        source_inference_id: input.source_inference_id,
        semantic_intent_kind: input.semantic_intent_kind ?? null,
        target_ref: input.target_ref ?? null,
        metadata: input.metadata ?? null
      });
      const tags = mergeTags(
        ['memory_record', 'decision_reflection', overlayType],
        input.semantic_intent_kind ? [`semantic:${input.semantic_intent_kind}`] : [],
        input.tags
      );

      const entry = input.existing_overlay_id
        ? await overlayStore.updateEntry({
            id: input.existing_overlay_id,
            title,
            content_text: reasoning,
            content_structured: structured,
            tags,
            status: 'active',
            updated_at_tick: input.tick
          })
        : await overlayStore.createEntry({
            actor_id: input.actor_id,
            pack_id: input.pack_id,
            overlay_type: overlayType,
            title,
            content_text: reasoning,
            content_structured: structured,
            tags,
            created_by: 'system',
            persistence_mode: overlayType === 'target_dossier' ? 'persistent' : 'sticky',
            created_at_tick: input.tick,
            updated_at_tick: input.tick
          });

      if (overlayType === 'target_dossier') {
        await upsertDeclaredPackCollectionRecord(input.pack_id, 'target_dossiers', {
          id: entry.id,
          owner_actor_id: input.actor_id,
          target_entity_id: typeof input.target_ref?.entity_id === 'string' ? input.target_ref.entity_id : null,
          confidence: typeof input.metadata?.confidence === 'number' ? input.metadata.confidence : null,
          content: { reasoning, structured }
        });
      }

      return {
        overlay_mutations: [toOverlayMutationRecord(entry, input.existing_overlay_id ? 'updated' : 'created')],
        memory_block_mutations: [],
        trace_memory_mutations: {
          records: [toInferenceMutationRecordFromOverlay(entry, input.existing_overlay_id ? 'updated' : 'created')]
        }
      };
    },

    async recordExecutionReflection(input) {
      const overlayEntry = await overlayStore.createEntry({
        actor_id: input.actor_id,
        pack_id: input.pack_id,
        overlay_type: 'self_note',
        title: `执行复盘 @ ${input.tick}`,
        content_text: buildExecutionReflectionText(input),
        content_structured: buildOverlayStructuredContent({
          record_kind: 'execution_postmortem',
          source_inference_id: input.source_inference_id,
          source_action_intent_id: input.source_action_intent_id,
          semantic_intent_kind: input.semantic_intent_kind ?? null,
          target_ref: input.target_ref ?? null,
          metadata: input.metadata ?? null
        }),
        tags: mergeTags(
          ['memory_record', 'execution_postmortem', `outcome:${input.outcome}`],
          input.semantic_intent_kind ? [`semantic:${input.semantic_intent_kind}`] : []
        ),
        created_by: 'system',
        persistence_mode: 'sticky',
        created_at_tick: input.tick,
        updated_at_tick: input.tick
      });

      const memoryBlockInput = buildMemoryBlockInput({
        actor_id: input.actor_id,
        pack_id: input.pack_id,
        tick: input.tick,
        kind: 'reflection',
        title: `执行复盘 ${input.intent_type}`,
        content_text: buildExecutionReflectionText(input),
        content_structured: buildExecutionReflectionSummary(input),
        tags: mergeTags(
          ['memory_record', 'execution_postmortem', 'reflection', `intent:${input.intent_type}`],
          input.semantic_intent_kind ? [`semantic:${input.semantic_intent_kind}`] : []
        ),
        keywords: mergeTags(
          [input.intent_type, input.outcome],
          input.semantic_intent_kind ? [input.semantic_intent_kind] : []
        ),
        source_ref: {
          source_kind: 'intent',
          source_id: input.source_action_intent_id
        }
      });
      await upsertDeclaredPackCollectionRecord(input.pack_id, 'investigation_threads', {
        id: overlayEntry.id,
        owner_actor_id: input.actor_id,
        subject_entity_id: typeof input.target_ref?.entity_id === 'string' ? input.target_ref.entity_id : input.actor_id,
        evidence_strength: typeof input.metadata?.evidence_strength === 'number'
          ? input.metadata.evidence_strength
          : input.outcome === 'completed' ? 0.7 : input.outcome === 'dropped' ? 0.3 : 0.5,
        content: buildExecutionReflectionSummary(input)
      });
      const memoryRecord: MemoryBlockRecord = await longMemoryBlockStore.upsertBlock(memoryBlockInput);

      return {
        overlay_mutations: [toOverlayMutationRecord(overlayEntry, 'created')],
        memory_block_mutations: [toMemoryBlockMutationRecord(memoryRecord.block, 'created')],
        trace_memory_mutations: {
          records: [
            toInferenceMutationRecordFromOverlay(overlayEntry, 'created'),
            toInferenceMutationRecordFromMemoryBlock(memoryRecord.block, 'created')
          ]
        }
      };
    }
  };
};
