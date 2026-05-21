import { z } from 'zod';

const PositiveIntSchema = z.number().int().positive();

export const PromptWorkflowProfileDefaultsSchema = z
  .object({
    token_budget: PositiveIntSchema,
    safety_margin_tokens: z.number().int().nonnegative().optional()
  })
  .strict();

export const PromptWorkflowConfigSchema = z
  .object({
    profiles: z
      .object({
        agent_decision_default: PromptWorkflowProfileDefaultsSchema,
        context_summary_default: PromptWorkflowProfileDefaultsSchema,
        memory_compaction_default: PromptWorkflowProfileDefaultsSchema,
        intent_grounding_assist_default: PromptWorkflowProfileDefaultsSchema
      })
      .strict()
  })
  .strict();

export type PromptWorkflowConfig = z.infer<typeof PromptWorkflowConfigSchema>;

export const PROMPT_WORKFLOW_DEFAULTS: PromptWorkflowConfig = {
  profiles: {
    agent_decision_default: {
      token_budget: 2200,
      safety_margin_tokens: 80
    },
    context_summary_default: {
      token_budget: 1600,
      safety_margin_tokens: 60
    },
    memory_compaction_default: {
      token_budget: 1800,
      safety_margin_tokens: 60
    },
    intent_grounding_assist_default: {
      token_budget: 1400,
      safety_margin_tokens: 60
    }
  }
};
