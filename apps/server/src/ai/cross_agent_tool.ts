import { buildPromptBundleFromAiMessages } from './prompt_bundle_from_messages.js';
import type { AiTaskService } from './task_service.js';
import type { ToolExecutionContext, ToolHandler, ToolRegistry } from './tool_executor.js';
import type { AiTaskRequest, AiTaskType } from './types.js';

export interface CrossAgentQuery {
  target_agent_id: string;
  task_type: AiTaskType;
  query: Record<string, unknown>;
  timeout_ms?: number;
}

export interface CrossAgentResult {
  success: boolean;
  target_agent_id: string;
  output?: unknown;
  error?: { code: string; message: string };
}

export interface CrossAgentBridge {
  queryAgent(query: CrossAgentQuery, ctx: ToolExecutionContext): Promise<CrossAgentResult>;
}

export const createCrossAgentBridge = (aiTaskService: AiTaskService): CrossAgentBridge => {
  return {
    async queryAgent(query, ctx) {
      const messages = [
        {
          role: 'system' as const,
          parts: [{ type: 'text' as const, text: 'You are responding to a cross-agent query from another agent.' }]
        },
        {
          role: 'user' as const,
          parts: [{ type: 'text' as const, text: JSON.stringify(query.query) }]
        }
      ];
      const taskId = `cross_agent_${query.target_agent_id}_${Date.now()}`;
      const taskRequest: AiTaskRequest = {
        task_id: taskId,
        task_type: query.task_type,
        pack_id: ctx.pack_id,
        input: query.query,
        prompt_context: {
          prompt_bundle_v2: buildPromptBundleFromAiMessages({ taskId, taskType: query.task_type, messages })
        }
      };

      try {
        const result = await aiTaskService.runTask<Record<string, unknown>>(taskRequest, {
          packAiConfig: null
        });

        return {
          success: true,
          target_agent_id: query.target_agent_id,
          output: result.output
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          success: false,
          target_agent_id: query.target_agent_id,
          error: { code: 'CROSS_AGENT_QUERY_FAILED', message }
        };
      }
    }
  };
};

export const createCrossAgentToolHandler = (bridge: CrossAgentBridge): ToolHandler => {
  return {
    async execute(args: Record<string, unknown>, ctx: ToolExecutionContext) {
      const targetAgentId = typeof args.target_agent_id === 'string' ? args.target_agent_id : null;
      const taskType = typeof args.task_type === 'string' ? args.task_type : 'agent_decision';
      const query = args.query && typeof args.query === 'object' ? args.query as Record<string, unknown> : {}; // eslint-disable-line @typescript-eslint/no-unsafe-type-assertion -- boundary type assertion

      if (!targetAgentId) {
        return { success: false, error: { code: 'MISSING_TARGET_AGENT', message: 'target_agent_id is required' } };
      }

      return bridge.queryAgent(
        {
          target_agent_id: targetAgentId,
          // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- boundary type assertion
          task_type: taskType as AiTaskType,
          query
        },
        ctx
      );
    }
  };
};

export const registerCrossAgentTool = (
  registry: ToolRegistry,
  bridge: CrossAgentBridge
): void => {
  const handler = createCrossAgentToolHandler(bridge);
  registry.register('query_agent', handler, {
    type: 'object',
    properties: {
      target_agent_id: { type: 'string', description: 'Target agent ID to query' },
      task_type: { type: 'string', description: 'AI task type for the target agent' },
      query: { type: 'object', description: 'Query payload to send to the target agent' }
    },
    required: ['target_agent_id']
  });
};
