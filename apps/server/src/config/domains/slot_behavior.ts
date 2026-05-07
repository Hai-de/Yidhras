import { z } from 'zod';

const SlotConditionSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('keyword_match'),
    keywords: z.array(z.string()).min(1),
    match_mode: z.enum(['any', 'all']).optional()
  }),
  z.object({
    type: z.literal('logic_match'),
    expression: z.record(z.string(), z.unknown())
  }),
  z.object({
    type: z.literal('context_length'),
    operator: z.enum(['gt', 'lt', 'gte', 'lte', 'eq']),
    value: z.number().int().positive()
  }),
  z.object({
    type: z.literal('conversation_turn'),
    operator: z.enum(['gt', 'lt', 'gte', 'lte', 'eq']),
    value: z.number().int().nonnegative()
  }),
  z.object({
    type: z.literal('custom'),
    evaluator_key: z.string(),
    options: z.record(z.string(), z.unknown()).optional()
  })
]);

const SlotBehaviorProfileSchema = z
  .object({
    slot_id: z.string(),

    // Activation control
    always_active: z.boolean().optional(),
    trigger_probability: z.number().min(0).max(1).optional(),
    conditions: z.array(SlotConditionSchema).optional(),
    condition_combination: z.enum(['and', 'or']).optional(),
    evaluator_failure_policy: z.enum(['activate', 'deactivate', 'abort']).optional(),

    // Depth & recursion
    max_depth: z.number().int().positive().optional(),
    no_recursion: z.boolean().optional(),
    prevent_further_recursion: z.boolean().optional(),

    // Order & group
    group_weight: z.number().positive().optional(),
    group_id: z.string().optional(),
    group_mode: z.enum(['exclusive', 'priority', 'budget']).optional(),
    render_order: z.number().int().optional(),

    // Stateful trigger rules
    sticky: z
      .object({
        max_activations: z.number().int().positive()
      })
      .optional(),
    cooldown: z
      .object({
        ticks: z.number().int().positive()
      })
      .optional(),
    delayed_trigger: z
      .object({
        delay_ticks: z.number().int().positive()
      })
      .optional(),

    // Context control
    ignore_context_length: z.boolean().optional(),

    // State lifecycle
    state_scope: z.enum(['conversation', 'inference', 'persistent']).optional(),

    // Dynamic matching plugins
    condition_evaluator: z.string().optional(),
    condition_evaluator_options: z.record(z.string(), z.unknown()).optional()
  })
  .strict();

export const SlotBehaviorConfigSchema = z.record(z.string(), SlotBehaviorProfileSchema);

export type SlotBehaviorConfig = z.infer<typeof SlotBehaviorConfigSchema>;
export type SlotBehaviorProfile = z.infer<typeof SlotBehaviorProfileSchema>;

export const SLOT_BEHAVIOR_DEFAULTS: SlotBehaviorConfig = {};
