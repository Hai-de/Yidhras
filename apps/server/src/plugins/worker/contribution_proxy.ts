import type { DataCleaner } from '@yidhras/contracts';
import {
  dataCleanerInputSchema,
  dataCleanerOutputSchema,
  slotConditionContextSchema,
  slotConditionResultSchema,
  slotTransformContextSchema,
  slotTransformResultSchema
} from '@yidhras/contracts';
import { z } from 'zod';

import type {
  QueryContribution,
  QueryContributor,
  RuleContribution,
  RuleContributor,
  StepContribution,
  StepContributor,
  WorldEngineSessionContext
} from '../../app/runtime/world_engine_contributors.js';
import type { ContextSourceAdapter, ContextSourceAdapterBuildResult, ContextSourceAdapterInput } from '../../context/source_registry.js';
import type { ContextNode } from '../../context/types.js';
import type { PromptWorkflowStepExecutor } from '../../context/workflow/registry.js';
import type { PromptWorkflowState, PromptWorkflowStepSpec } from '../../context/workflow/types.js';
import type { PerceptionResolver,PerceptionRuleInput, PerceptionRuleOutput } from '../../perception/types.js';
import type { SlotConditionEvaluator } from '../extensions/slot_condition_registry.js';
import type { SlotContentTransformer } from '../extensions/slot_content_transformer.js';
import type {
  ContextSourceDescriptor,
  ContributionDescriptor,
  DataCleanerDescriptor,
  PackRouteDescriptor,
  PerceptionResolverDescriptor,
  PromptWorkflowStepDescriptor,
  QueryContributorDescriptor,
  RuleContributorDescriptor,
  SlotConditionEvaluatorDescriptor,
  SlotContentTransformerDescriptor,
  StepContributorDescriptor
} from './contribution_descriptors.js';
import type { PluginWorkerClient } from './PluginWorkerClient.js';

const recordSchema = z.record(z.string(), z.unknown());

/**
 * Coerce a Zod schema to a target output type.  Used at plugin-worker
 * boundaries where the schema validates a Rust-sent subset of fields and
 * the TS host enriches the remainder — the runtime contract is looser than
 * the full TS interface.  The double assertion is contained here so no
 * caller needs `as unknown as`.
 */
 
 
function coerceSchema<T>(schema: z.ZodType): z.ZodType<T> {
  return schema as unknown as z.ZodType<T>;
}

// ── Policy type schemas (replaced bare recordSchema for type safety) ──────
const visibilityPolicySchema = z.object({
  level: z.enum(['hidden_mandatory', 'visible_fixed', 'visible_flexible', 'writable_overlay']),
  read_access: z.enum(['visible', 'exists_only', 'hidden']),
  policy_gate: z.string().nullable().optional(),
  blocked: z.boolean().optional()
}).loose();

const mutabilityPolicySchema = z.object({
  level: z.enum(['immutable', 'fixed', 'flexible', 'overlay']),
  can_summarize: z.boolean(),
  can_reorder: z.boolean(),
  can_hide: z.boolean()
}).loose();

const placementPolicySchema = z.object({
  preferred_slot: z.string().nullable(),
  locked: z.boolean(),
  tier: z.enum(['system', 'world', 'memory', 'output', 'post_process', 'other'])
}).loose();

const provenanceSchema = z.object({
  created_by: z.enum(['system', 'agent', 'plugin']),
  created_at_tick: z.string(),
  parent_node_ids: z.array(z.string()).optional()
}).loose();

const jsonClone = (value: unknown): unknown => {
  const bigintReplacer = (_key: string, current: unknown): unknown => {
    if (typeof current === 'bigint') {
      return current.toString();
    }
    return current;
  };
  return JSON.parse(JSON.stringify(value, bigintReplacer));
};

const invokeWorker = async <T>(input: {
  client: PluginWorkerClient;
  descriptor: ContributionDescriptor;
  payload: unknown;
  outputSchema: z.ZodType<T>;
  timeoutMs?: number;
}): Promise<T> => {
  const payload = jsonClone(input.payload);
// @ts-expect-error -- EOPT strict mode
  const result = await input.client.invoke(input.descriptor.type, input.descriptor.invoke, payload, {
    timeoutMs: input.timeoutMs
  });
  return input.outputSchema.parse(result);
};

const contextNodeSchema = z.object({
  id: z.string().trim().min(1),
  node_type: z.string().trim().min(1),
  scope: z.enum(['system', 'pack', 'agent', 'plugin']),
  source_kind: z.enum([
    'trace', 'intent', 'job', 'post', 'event',
    'summary', 'manual', 'policy_summary', 'pack_state',
    'world_state', 'overlay', 'spatial_proximity'
  ]),
  source_ref: recordSchema.nullable(),
  actor_ref: recordSchema.nullable().optional(),
  content: z.object({
    text: z.string(),
    structured: recordSchema.optional(),
    raw: z.unknown().optional()
  }),
  tags: z.array(z.string()),
  importance: z.number(),
  salience: z.number(),
  confidence: z.number().nullable().optional(),
  created_at: z.string(),
  occurred_at: z.string().nullable().optional(),
  expires_at: z.string().nullable().optional(),
  visibility: visibilityPolicySchema,
  mutability: mutabilityPolicySchema,
  placement_policy: placementPolicySchema,
  provenance: provenanceSchema,
  metadata: recordSchema.optional()
}).loose();


const contextSourceBuildResultSchema: z.ZodType<ContextNode[] | ContextSourceAdapterBuildResult> = z.union([
  z.array(contextNodeSchema),
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- Zod schema loose() cast to union member
  z.object({
    nodes: z.array(contextNodeSchema),
    diagnostics: recordSchema.nullable().optional()
  }).loose() as z.ZodType<ContextSourceAdapterBuildResult>
]);
 

const promptWorkflowStateSchema = coerceSchema<PromptWorkflowState>(z.object({
  pack_id: z.string(),
  profile: recordSchema,
  selected_nodes: z.array(contextNodeSchema),
  working_set: z.array(contextNodeSchema),
  grouped_nodes: recordSchema,
  section_drafts: z.array(z.unknown()),
  diagnostics: z.object({
    profile_id: z.string(),
    profile_version: z.string(),
    selected_step_keys: z.array(z.string()),
    step_traces: z.array(z.unknown())
  }).loose()
}).loose());

// eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- Zod schema loose() cast
const stepContributionSchema: z.ZodType<StepContribution> = z.object({
  delta_operations: z.array(z.unknown()),
  emitted_events: z.array(z.unknown()),
  observability: z.array(z.unknown())
}) as z.ZodType<StepContribution>;

const nullableStepContributionSchema = stepContributionSchema.nullable();

/* eslint-disable @typescript-eslint/no-unsafe-type-assertion -- boundary type assertion */
const ruleContributionSchema: z.ZodType<RuleContribution> = z.object({
  rule_id: z.string(),
  mutations: z.array(z.unknown()),
  emitted_events: z.array(z.unknown()),
  diagnostics: z.object({
    no_match_reason: z.string().nullable().optional(),
    evaluated_rule_count: z.number().optional(),
    rendered_template_count: z.number().optional()
  }).optional()
}) as z.ZodType<RuleContribution>;
/* eslint-enable @typescript-eslint/no-unsafe-type-assertion */

const nullableRuleContributionSchema = ruleContributionSchema.nullable();

/* eslint-disable @typescript-eslint/no-unsafe-type-assertion -- boundary type assertion */
const queryContributionSchema: z.ZodType<QueryContribution> = z.object({
  data: z.unknown(),
  warnings: z.array(z.unknown()).optional(),
  next_cursor: z.string().nullable().optional()
}) as z.ZodType<QueryContribution>;
/* eslint-enable @typescript-eslint/no-unsafe-type-assertion */

const nullableQueryContributionSchema = queryContributionSchema.nullable();

const perceptionRuleOutputSchema: z.ZodType<PerceptionRuleOutput> = z.object({
  level: z.enum(['full', 'partial', 'none']),
  visibleDescription: z.string(),
  hiddenDescription: z.string().nullable(),
  matchedRuleId: z.string().nullable()
});

export class WorkerContextSourceAdapterProxy implements ContextSourceAdapter {
  public readonly name: string;

  constructor(
    private readonly client: PluginWorkerClient,
    private readonly descriptor: ContextSourceDescriptor
  ) {
    this.name = descriptor.name;
  }

  public buildNodes(input: ContextSourceAdapterInput): Promise<ContextNode[] | ContextSourceAdapterBuildResult> {
    return invokeWorker({
      client: this.client,
      descriptor: this.descriptor,
      payload: input,
      outputSchema: contextSourceBuildResultSchema
    });
  }
}

export class WorkerPromptWorkflowStepProxy implements PromptWorkflowStepExecutor {
  public readonly kind: PromptWorkflowStepSpec['kind'];

  constructor(
    private readonly client: PluginWorkerClient,
    private readonly descriptor: PromptWorkflowStepDescriptor
  ) {
    this.kind = descriptor.stepKind;
  }

  public execute(input: {
    context: Parameters<PromptWorkflowStepExecutor['execute']>[0]['context'];
    profile: Parameters<PromptWorkflowStepExecutor['execute']>[0]['profile'];
    spec: Parameters<PromptWorkflowStepExecutor['execute']>[0]['spec'];
    state: PromptWorkflowState;
  }): Promise<PromptWorkflowState> {
    return invokeWorker({
      client: this.client,
      descriptor: this.descriptor,
      payload: input,
      outputSchema: promptWorkflowStateSchema
    });
  }
}

export class WorkerStepContributorProxy implements StepContributor {
  public readonly name: string;
  public readonly priority: number;

  constructor(
    private readonly client: PluginWorkerClient,
    private readonly descriptor: StepContributorDescriptor
  ) {
    this.name = descriptor.name;
    this.priority = descriptor.priority;
  }

  public contributePrepare(
    input: Parameters<StepContributor['contributePrepare']>[0],
    context: WorldEngineSessionContext
  ): Promise<StepContribution | null> {
    return invokeWorker({
      client: this.client,
      descriptor: this.descriptor,
      payload: { prepareInput: input, context },
      outputSchema: nullableStepContributionSchema
    });
  }
}

export class WorkerRuleContributorProxy implements RuleContributor {
  public readonly name: string;
  public readonly priority: number;

  constructor(
    private readonly client: PluginWorkerClient,
    private readonly descriptor: RuleContributorDescriptor
  ) {
    this.name = descriptor.name;
    this.priority = descriptor.priority;
  }

  public contributeExecution(
    input: Parameters<RuleContributor['contributeExecution']>[0],
    context: WorldEngineSessionContext
  ): Promise<RuleContribution | null> {
    return invokeWorker({
      client: this.client,
      descriptor: this.descriptor,
      payload: { input, context },
      outputSchema: nullableRuleContributionSchema
    });
  }
}

export class WorkerQueryContributorProxy implements QueryContributor {
  public readonly name: string;
  public readonly priority: number;
  public readonly supports_query_name: string;

  constructor(
    private readonly client: PluginWorkerClient,
    private readonly descriptor: QueryContributorDescriptor
  ) {
    this.name = descriptor.name;
    this.priority = descriptor.priority;
    this.supports_query_name = descriptor.supportsQueryNames[0] ?? '*';
  }

  public contributeQuery(
    input: Parameters<QueryContributor['contributeQuery']>[0],
    context: WorldEngineSessionContext
  ): Promise<QueryContribution | null> {
    return invokeWorker({
      client: this.client,
      descriptor: this.descriptor,
      payload: { input, context },
      outputSchema: nullableQueryContributionSchema
    });
  }
}

export class WorkerDataCleanerProxy implements DataCleaner {
  public readonly key: string;
  public readonly version: string;

  constructor(
    private readonly client: PluginWorkerClient,
    private readonly descriptor: DataCleanerDescriptor
  ) {
    this.key = descriptor.key;
    this.version = descriptor.version;
  }

  public async clean(input: Parameters<DataCleaner['clean']>[0]): Promise<Awaited<ReturnType<DataCleaner['clean']>>> {
    const parsedInput = dataCleanerInputSchema.parse(input);
    return invokeWorker({
      client: this.client,
      descriptor: this.descriptor,
      payload: parsedInput,
      outputSchema: dataCleanerOutputSchema
    });
  }
}

export class WorkerSlotConditionEvaluatorProxy implements SlotConditionEvaluator {
  public readonly key: string;
  public readonly version: string;

  constructor(
    private readonly client: PluginWorkerClient,
    private readonly descriptor: SlotConditionEvaluatorDescriptor
  ) {
    this.key = descriptor.key;
    this.version = descriptor.version;
  }

  public evaluate(context: Parameters<SlotConditionEvaluator['evaluate']>[0]): Promise<Awaited<ReturnType<SlotConditionEvaluator['evaluate']>>> {
    const parsedContext = slotConditionContextSchema.parse(context);
    return invokeWorker({
      client: this.client,
      descriptor: this.descriptor,
      payload: parsedContext,
      outputSchema: slotConditionResultSchema
    });
  }
}

export class WorkerSlotContentTransformerProxy implements SlotContentTransformer {
  public readonly key: string;
  public readonly version: string;

  constructor(
    private readonly client: PluginWorkerClient,
    private readonly descriptor: SlotContentTransformerDescriptor
  ) {
    this.key = descriptor.key;
    this.version = descriptor.version;
  }

  public transform(
    content: string,
    context: Parameters<SlotContentTransformer['transform']>[1]
  ): Promise<Awaited<ReturnType<SlotContentTransformer['transform']>>> {
    const parsedContext = slotTransformContextSchema.parse(context);
    return invokeWorker({
      client: this.client,
      descriptor: this.descriptor,
      payload: { content, context: parsedContext },
      outputSchema: slotTransformResultSchema
    });
  }
}

export class WorkerPerceptionResolverProxy implements PerceptionResolver {
  constructor(
    private readonly client: PluginWorkerClient,
    private readonly descriptor: PerceptionResolverDescriptor
  ) {}

  public resolve(input: PerceptionRuleInput): Promise<PerceptionRuleOutput> {
    return invokeWorker({
      client: this.client,
      descriptor: this.descriptor,
      payload: { input },
      outputSchema: perceptionRuleOutputSchema
    });
  }
}

export class WorkerPackRouteProxy {
  public readonly method: PackRouteDescriptor['method'];
  public readonly path: string;
  public readonly name: string;

  constructor(
    private readonly client: PluginWorkerClient,
    private readonly descriptor: PackRouteDescriptor
  ) {
    this.method = descriptor.method;
    this.path = descriptor.path;
    this.name = descriptor.name;
  }

  public handle(payload: unknown, timeoutMs?: number): Promise<unknown> {
// @ts-expect-error -- EOPT strict mode
    return invokeWorker({
      client: this.client,
      descriptor: this.descriptor,
      payload,
      outputSchema: z.unknown(),
      timeoutMs
    });
  }
}

export interface WorkerContributionProxyBundle {
  context_sources: ContextSourceAdapter[];
  prompt_workflow_steps: PromptWorkflowStepExecutor[];
  pack_routes: WorkerPackRouteProxy[];
  step_contributors: StepContributor[];
  rule_contributors: RuleContributor[];
  query_contributors: QueryContributor[];
  data_cleaners: WorkerDataCleanerProxy[];
  slot_condition_evaluators: SlotConditionEvaluator[];
  slot_content_transformers: SlotContentTransformer[];
  perception_resolvers: PerceptionResolver[];
}

export const createWorkerContributionProxies = (
  client: PluginWorkerClient,
  descriptors: ContributionDescriptor[]
): WorkerContributionProxyBundle => {
  const bundle: WorkerContributionProxyBundle = {
    context_sources: [],
    prompt_workflow_steps: [],
    pack_routes: [],
    step_contributors: [],
    rule_contributors: [],
    query_contributors: [],
    data_cleaners: [],
    slot_condition_evaluators: [],
    slot_content_transformers: [],
    perception_resolvers: []
  };

  for (const descriptor of descriptors) {
    switch (descriptor.type) {
      case 'context_source':
        bundle.context_sources.push(new WorkerContextSourceAdapterProxy(client, descriptor));
        break;
      case 'prompt_workflow_step':
        bundle.prompt_workflow_steps.push(new WorkerPromptWorkflowStepProxy(client, descriptor));
        break;
      case 'api_route':
        bundle.pack_routes.push(new WorkerPackRouteProxy(client, descriptor));
        break;
      case 'step_contributor':
        bundle.step_contributors.push(new WorkerStepContributorProxy(client, descriptor));
        break;
      case 'rule_contributor':
        bundle.rule_contributors.push(new WorkerRuleContributorProxy(client, descriptor));
        break;
      case 'query_contributor':
        bundle.query_contributors.push(new WorkerQueryContributorProxy(client, descriptor));
        break;
      case 'data_cleaner':
        bundle.data_cleaners.push(new WorkerDataCleanerProxy(client, descriptor));
        break;
      case 'slot_condition_evaluator':
        bundle.slot_condition_evaluators.push(new WorkerSlotConditionEvaluatorProxy(client, descriptor));
        break;
      case 'slot_content_transformer':
        bundle.slot_content_transformers.push(new WorkerSlotContentTransformerProxy(client, descriptor));
        break;
      case 'perception_resolver':
        bundle.perception_resolvers.push(new WorkerPerceptionResolverProxy(client, descriptor));
        break;
    }
  }

  return bundle;
};
