import { buildAiTaskRequestFromInferenceContext } from '../../ai/task_prompt_builder.js';
import type { AiTaskService } from '../../ai/task_service.js';
import { createAiTaskService } from '../../ai/task_service.js';
import type { AppInfrastructure } from '../../app/context.js';
import type { AppContextPorts } from '../../app/services/app_context_ports.js';
import { isAiGatewayEnabled } from '../../config/runtime_config.js';
import { createContextOverlayStore } from '../../context/overlay/store.js';
import { buildInferenceContext } from '../../inference/context_builder.js';
import { createPrismaLongMemoryBlockStore } from '../blocks/store.js';
import type { LongMemoryBlockStore } from '../blocks/types.js';
import { createMemoryRecordingService, type MemoryRecordingMutationBundle } from './service.js';

const DEFAULT_SUMMARY_EVERY_N_ROUNDS = 5;
const DEFAULT_COMPACTION_EVERY_N_ROUNDS = 5;

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
};

const toPositiveInt = (value: unknown, fallback: number): number => {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : fallback;
};

export interface MemoryCompactionThresholds {
  summary_every_n_rounds: number;
  compaction_every_n_rounds: number;
}

export interface MemoryCompactionRunResult {
  actor_id: string;
  thresholds: MemoryCompactionThresholds;
  state: {
    inference_count_since_summary: number;
    inference_count_since_compaction: number;
    last_summary_tick: string | null;
    last_compaction_tick: string | null;
  };
  triggered: {
    context_summary: boolean;
    memory_compaction: boolean;
  };
  mutations: MemoryRecordingMutationBundle;
}

export interface MemoryCompactionService {
  getThresholdsForPack(packAiConfig: unknown): MemoryCompactionThresholds;
  runForAgent(input: { agent_id: string; identity_id?: string }): Promise<MemoryCompactionRunResult | null>;
}

type CompactionServiceContext = AppInfrastructure & Pick<AppContextPorts, 'activePackRuntime'>;

export interface CreateMemoryCompactionServiceOptions {
  context: CompactionServiceContext;
  aiTaskService?: AiTaskService;
  longMemoryBlockStore?: LongMemoryBlockStore;
}

const emptyMutations = (): MemoryRecordingMutationBundle => ({
  overlay_mutations: [],
  memory_block_mutations: [],
  trace_memory_mutations: { records: [] }
});

export const createMemoryCompactionService = ({
  context,
  aiTaskService = createAiTaskService({ context }),
  longMemoryBlockStore = createPrismaLongMemoryBlockStore(context)
}: CreateMemoryCompactionServiceOptions): MemoryCompactionService => {
  return {
    getThresholdsForPack(packAiConfig: unknown): MemoryCompactionThresholds {
      const memoryLoop = isRecord(packAiConfig) && isRecord(packAiConfig.memory_loop) ? packAiConfig.memory_loop : null;
      return {
        summary_every_n_rounds: toPositiveInt(memoryLoop?.summary_every_n_rounds, DEFAULT_SUMMARY_EVERY_N_ROUNDS),
        compaction_every_n_rounds: toPositiveInt(memoryLoop?.compaction_every_n_rounds, DEFAULT_COMPACTION_EVERY_N_ROUNDS)
      };
    },

    async runForAgent(input) {
      const pack = context.activePackRuntime?.getActivePack();
      if (!pack) {
        return null;
      }

      const thresholds = this.getThresholdsForPack(pack.ai ?? null);
      if (!isAiGatewayEnabled()) {
        return {
          actor_id: input.agent_id,
          thresholds,
          state: {
            inference_count_since_summary: 0,
            inference_count_since_compaction: 0,
            last_summary_tick: null,
            last_compaction_tick: null
          },
          triggered: {
            context_summary: false,
            memory_compaction: false
          },
          mutations: emptyMutations()
        };
      }

      const now = context.clock.getCurrentTick();
      const state = await context.prisma.memoryCompactionState.upsert({
        where: { agent_id: input.agent_id },
        update: {
          pack_id: pack.metadata.id,
          inference_count_since_summary: { increment: 1 },
          inference_count_since_compaction: { increment: 1 },
          updated_at_tick: now
        },
        create: {
          agent_id: input.agent_id,
          pack_id: pack.metadata.id,
          inference_count_since_summary: 1,
          inference_count_since_compaction: 1,
          updated_at_tick: now
        }
      });

      const shouldRunSummary = state.inference_count_since_summary >= thresholds.summary_every_n_rounds;
      const shouldRunCompaction = state.inference_count_since_compaction >= thresholds.compaction_every_n_rounds;
      if (!shouldRunSummary && !shouldRunCompaction) {
        return {
          actor_id: input.agent_id,
          thresholds,
          state: {
            inference_count_since_summary: state.inference_count_since_summary,
            inference_count_since_compaction: state.inference_count_since_compaction,
            last_summary_tick: state.last_summary_tick?.toString() ?? null,
            last_compaction_tick: state.last_compaction_tick?.toString() ?? null
          },
          triggered: {
            context_summary: false,
            memory_compaction: false
          },
          mutations: emptyMutations()
        };
      }

      const inferenceContext = await buildInferenceContext(context, {
        agent_id: input.agent_id,
        identity_id: input.identity_id ?? input.agent_id,
        strategy: 'rule_based',
        attributes: {
          compaction_run: true,
          compaction_source: 'memory_loop'
        }
      });

      const recordingService = createMemoryRecordingService({ context, longMemoryBlockStore });
      const overlayStore = createContextOverlayStore(context);
      let summaryText: string | null = null;
      let compactionText: string | null = null;
      const aggregatedMutations = emptyMutations();

      if (shouldRunSummary) {
        const request = await buildAiTaskRequestFromInferenceContext(inferenceContext, {
          task_type: 'context_summary',
          task_id: `context-summary:${input.agent_id}:${now.toString()}`,
          input: {
            actor_id: input.agent_id,
            run_kind: 'context_summary',
            recent_memory_context: inferenceContext.memory_context,
            pack_state: inferenceContext.pack_state
          }
        });
        const result = await aiTaskService.runTask<Record<string, unknown>>(request, {
          packAiConfig: inferenceContext.world_ai ?? null
        });
        summaryText = typeof result.output.summary === 'string' ? result.output.summary : null;
        if (summaryText) {
          const existingSummary = (await overlayStore.listEntries({
            actor_id: input.agent_id,
            pack_id: pack.metadata.id,
            statuses: ['active'],
            limit: 10
          })).find(entry => entry.overlay_type === 'system_summary') ?? null;
          const overlayMutation = existingSummary
            ? await overlayStore.updateEntry({
                id: existingSummary.id,
                title: `系统摘要 @ ${now.toString()}`,
                content_text: summaryText,
                content_structured: {
                  record_kind: 'context_summary',
                  task_id: result.task_id,
                  ai_invocation_id: result.invocation.invocation_id,
                  output: result.output
                },
                tags: ['memory_record', 'context_summary', 'system_summary'],
                updated_at_tick: now.toString()
              })
            : await overlayStore.createEntry({
                actor_id: input.agent_id,
                pack_id: pack.metadata.id,
                overlay_type: 'system_summary',
                title: `系统摘要 @ ${now.toString()}`,
                content_text: summaryText,
                content_structured: {
                  record_kind: 'context_summary',
                  task_id: result.task_id,
                  ai_invocation_id: result.invocation.invocation_id,
                  output: result.output
                },
                tags: ['memory_record', 'context_summary', 'system_summary'],
                created_by: 'system',
                persistence_mode: 'persistent',
                created_at_tick: now.toString(),
                updated_at_tick: now.toString()
              });
          aggregatedMutations.overlay_mutations.push({
            overlay_id: overlayMutation.id,
            operation: existingSummary ? 'updated' : 'created',
            node_id: overlayMutation.id,
            status: overlayMutation.status
          });
          aggregatedMutations.trace_memory_mutations.records.push({
            kind: 'overlay',
            record_id: overlayMutation.id,
            operation: existingSummary ? 'updated' : 'created',
            actor_id: overlayMutation.actor_id,
            pack_id: overlayMutation.pack_id,
            note_kind: overlayMutation.overlay_type,
            status: overlayMutation.status,
            metadata: overlayMutation.content_structured
          });
        }
      }

      if (shouldRunCompaction) {
        const request = await buildAiTaskRequestFromInferenceContext(inferenceContext, {
          task_type: 'memory_compaction',
          task_id: `memory-compaction:${input.agent_id}:${now.toString()}`,
          input: {
            actor_id: input.agent_id,
            run_kind: 'memory_compaction',
            recent_memory_context: inferenceContext.memory_context,
            pack_state: inferenceContext.pack_state
          }
        });
        const result = await aiTaskService.runTask<Record<string, unknown>>(request, {
          packAiConfig: inferenceContext.world_ai ?? null
        });
        compactionText = typeof result.output.compaction === 'string' ? result.output.compaction : null;
      }

      const updatedState = await context.prisma.memoryCompactionState.update({
        where: { agent_id: input.agent_id },
        data: {
          inference_count_since_summary: shouldRunSummary ? 0 : state.inference_count_since_summary,
          inference_count_since_compaction: shouldRunCompaction ? 0 : state.inference_count_since_compaction,
          last_summary_tick: shouldRunSummary ? now : state.last_summary_tick,
          last_compaction_tick: shouldRunCompaction ? now : state.last_compaction_tick,
          updated_at_tick: now
        }
      });

      return {
        actor_id: input.agent_id,
        thresholds,
        state: {
          inference_count_since_summary: updatedState.inference_count_since_summary,
          inference_count_since_compaction: updatedState.inference_count_since_compaction,
          last_summary_tick: updatedState.last_summary_tick?.toString() ?? null,
          last_compaction_tick: updatedState.last_compaction_tick?.toString() ?? null
        },
        triggered: {
          context_summary: shouldRunSummary,
          memory_compaction: shouldRunCompaction
        },
        mutations: {
          ...aggregatedMutations,
          ...(summaryText || compactionText ? await recordingService.recordPrivateReflection({
            actor_id: input.agent_id,
            pack_id: pack.metadata.id,
            tick: now.toString(),
            source_inference_id: inferenceContext.inference_id,
            reasoning: [summaryText, compactionText].filter(Boolean).join('\n\n') || null,
            tags: ['memory_compaction']
          }) : emptyMutations())
        }
      };
    }
  };
};
