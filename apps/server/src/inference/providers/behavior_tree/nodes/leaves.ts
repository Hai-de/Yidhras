import { buildPromptBundleFromAiMessages } from '../../../../ai/prompt_bundle_from_messages.js';
import type { AiMessage } from '../../../../ai/types.js';
import { evaluateCondition } from '../context_resolver.js';
import type { BTActionDef, BTEvalContext, BTLLMDecisionDef, BTNodeDef, BTStatus } from '../types.js';

export function tickCondition(
  condition: BTNodeDef['condition'],
  ctx: BTEvalContext
): BTStatus {
  if (!condition) return 'failure';
  return evaluateCondition(condition, ctx) ? 'success' : 'failure';
}

export async function tickAction(
  action: BTActionDef,
  ctx: BTEvalContext
): Promise<BTStatus> {
  if (action.call_handler && ctx.callHandler) {
    try {
      const handlerResult = await ctx.callHandler(action.call_handler, {
        action,
        blackboard: ctx.blackboard
      });
      ctx.blackboard['__last_decision'] = {
        ...buildDecisionResult(action),
        ...(handlerResult ?? {})
      };
      return 'success';
    } catch {
      return 'failure';
    }
  }

  ctx.blackboard['__last_decision'] = buildDecisionResult(action);
  return 'success';
}

export async function tickLLMDecision(
  llm: BTLLMDecisionDef,
  ctx: BTEvalContext
): Promise<BTStatus> {
  if (!ctx.aiTaskService) {
    return 'failure';
  }

  try {
    const messages: AiMessage[] = [
      { role: 'system', parts: [{ type: 'text', text: 'You are a simulation agent making decisions. Respond with a concise action description.' }] },
      { role: 'user', parts: [{ type: 'text', text: llm.prompt_template }] }
    ];

    const rawTreeName = ctx.blackboard['__tree_name'];
    const treeName = typeof rawTreeName === 'string' ? rawTreeName : 'unknown';
    const taskId = `bt_llm_decision:${treeName}`;

    const promptBundle = buildPromptBundleFromAiMessages({
      taskId,
      taskType: 'agent_decision',
      messages
    });

    const result = await ctx.aiTaskService.runTask<string>({
      task_id: taskId,
      task_type: 'agent_decision',
      input: {},
      prompt_context: { prompt_bundle_v2: promptBundle },
      output_contract: { mode: 'free_text' },
      route_hints: {
        provider: llm.provider !== 'unknown' ? llm.provider : undefined,
        model: llm.model !== 'unknown' ? llm.model : undefined
      }
    });

    const responseText = result.output;
    ctx.blackboard['__last_decision'] = buildLLMDecisionResult(llm, responseText);
    return 'success';
  } catch {
    return 'failure';
  }
}

function buildDecisionResult(action: BTActionDef): Record<string, unknown> {
  return {
    action_type: action.semantic_intent ?? action.kernel ?? 'unknown',
    target_ref: action.target_ref ?? null,
    payload: action.payload ?? {},
    reasoning: action.reasoning ?? undefined,
    confidence: undefined,
    delay_hint_ticks: undefined,
    meta: undefined
  };
}

function buildLLMDecisionResult(llm: BTLLMDecisionDef, responseText: string): Record<string, unknown> {
  return {
    action_type: 'llm_decision',
    target_ref: null,
    payload: { prompt_template: llm.prompt_template, response: responseText },
    reasoning: responseText.slice(0, 500),
    confidence: undefined,
    delay_hint_ticks: undefined,
    meta: { provider: llm.provider, model: llm.model }
  };
}
