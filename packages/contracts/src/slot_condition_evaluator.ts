import { z } from 'zod';

const nonEmptyStringSchema = z.string().trim().min(1);

// ── 能力声明（插件 manifest 的 provides 字段） ──

export const slotConditionInterfaceKeySchema = z
  .string()
  .regex(/^slot_condition\.\w+$/, 'must be a slot_condition.<name> key');

export const slotConditionCapabilitySchema = z.object({
  key: slotConditionInterfaceKeySchema,
  version: nonEmptyStringSchema
});

export const slotTransformInterfaceKeySchema = z
  .string()
  .regex(/^slot_transform\.\w+$/, 'must be a slot_transform.<name> key');

export const slotTransformCapabilitySchema = z.object({
  key: slotTransformInterfaceKeySchema,
  version: nonEmptyStringSchema
});

// ── 门控型：条件评估器 ──

export const slotConditionContextSchema = z.object({
  slot_id: nonEmptyStringSchema,
  variables: z.record(z.string(), z.unknown()),
  conversation_meta: z.object({
    turn_count: z.number().int().nonnegative(),
    last_message_role: z.string().optional()
  }),
  token_budget: z.object({
    total: z.number().int().nonnegative(),
    used: z.number().int().nonnegative(),
    remaining: z.number().int().nonnegative()
  }),
  current_tick: z.number().int().nonnegative(),
  last_user_message: z.string(),
  options: z.record(z.string(), z.unknown()).optional()
});

export const slotConditionResultSchema = z.object({
  active: z.boolean(),
  reason: z.string().optional(),
  confidence: z.number().min(0).max(1).optional()
});

// ── 变换型：内容变换器 ──

export const slotTransformContextSchema = slotConditionContextSchema.extend({
  original_content: z.string(),
  activation_decision: slotConditionResultSchema
});

export const slotTransformResultSchema = z.object({
  transformed: z.string(),
  metadata: z.record(z.string(), z.unknown()).optional()
});

// ── 推断类型 ──

export type SlotConditionCapability = z.infer<typeof slotConditionCapabilitySchema>;
export type SlotConditionContext = z.infer<typeof slotConditionContextSchema>;
export type SlotConditionResult = z.infer<typeof slotConditionResultSchema>;
export type SlotTransformCapability = z.infer<typeof slotTransformCapabilitySchema>;
export type SlotTransformContext = z.infer<typeof slotTransformContextSchema>;
export type SlotTransformResult = z.infer<typeof slotTransformResultSchema>;
