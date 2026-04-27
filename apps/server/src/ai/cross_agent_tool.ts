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
      const taskRequest: AiTaskRequest = {
        task_id: `cross_agent_${query.target_agent_id}_${Date.now()}`,
        task_type: query.task_type,
        pack_id: ctx.pack_id,
        input: query.query,
        prompt_context: {
          messages: [
            {
              role: 'system',
              parts: [{ type: 'text', text: `You are responding to a cross-agent query from another agent.` }]
            },
            {
              role: 'user',
              parts: [{ type: 'text', text: JSON.stringify(query.query) }]
            }
          ]
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
      const query = args.query && typeof args.query === 'object' ? args.query as Record<string, unknown> : {};

      if (!targetAgentId) {
        return { success: false, error: { code: 'MISSING_TARGET_AGENT', message: 'target_agent_id is required' } };
      }

      return bridge.queryAgent(
        {
          target_agent_id: targetAgentId,
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
