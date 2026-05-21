import { randomUUID } from 'node:crypto';

import {
  aiInvocationIdParamsSchema,
  aiInvocationsQuerySchema,
  inferenceJobIdParamsSchema,
  inferenceJobReplayRequestSchema,
  inferenceJobsQuerySchema,
  inferenceRequestSchema
} from '@yidhras/contracts';
import type { Express, NextFunction, Request, Response } from 'express';
import { z } from 'zod';

import { createModelGateway } from '../../ai/gateway.js';
import { resolveAiTaskConfig } from '../../ai/task_definitions.js';
import type { AiMessage, AiResponseMode, AiTaskRequest, AiTaskType, ModelGatewayRequest } from '../../ai/types.js';
import type { InferenceService } from '../../inference/service.js';
import type { OperatorRequest } from '../../operator/auth/types.js';
import type { AppContext } from '../context.js';
import { jsonOk, toJsonSafe } from '../http/json.js';
import { parseBody, parseParams, parseQuery } from '../http/zod.js';
import { requireAuth } from '../middleware/require_auth.js';
import {
  getActionIntentByInferenceId,
  getAiInvocationById,
  getDecisionJobById,
  getDecisionJobByInferenceId,
  getInferenceTraceById,
  getWorkflowSnapshotByInferenceId,
  getWorkflowSnapshotByJobId,
  listAiInvocations,
  listInferenceJobs
} from '../services/inference_workflow.js';
import { getOperatorPackIds } from '../services/operator/operator_pack_bindings.js';

export interface InferenceRouteDependencies {
  asyncHandler(
    handler: (req: Request, res: Response, next: NextFunction) => Promise<void>
  ): (req: Request, res: Response, next: NextFunction) => void;
}

export const registerInferenceRoutes = (
  app: Express,
  context: AppContext,
  inferenceService: InferenceService,
  deps: InferenceRouteDependencies
): void => {
  app.post(
    '/api/inference/preview',
    requireAuth(),
    deps.asyncHandler(async (req, res) => {
      context.assertRuntimeReady('inference preview');
      const input = parseBody(inferenceRequestSchema, req.body, 'INFERENCE_INPUT_INVALID');
      const result = await inferenceService.previewInference(input);

      jsonOk(res, toJsonSafe(result));
    })
  );

  app.post(
    '/api/inference/run',
    requireAuth(),
    deps.asyncHandler(async (req, res) => {
      context.assertRuntimeReady('inference run');
      const input = parseBody(inferenceRequestSchema, req.body, 'INFERENCE_INPUT_INVALID');
      const result = await inferenceService.runInference(input);

      jsonOk(res, toJsonSafe(result));
    })
  );

  app.get(
    '/api/inference/jobs',
    requireAuth(),
    deps.asyncHandler(async (req, res) => {
      context.assertRuntimeReady('inference jobs list');
      const operator = (req as OperatorRequest).operator!;
      const query = parseQuery(inferenceJobsQuerySchema, req.query, 'INFERENCE_INPUT_INVALID');
      const normalizedStatus = Array.isArray(query.status)
        ? query.status
        : typeof query.status === 'string'
          ? [query.status]
          : undefined;
      const limit = typeof query.limit === 'string' ? Number.parseInt(query.limit, 10) : undefined;
      const hasError = query.has_error === 'true' ? true : query.has_error === 'false' ? false : undefined;
      const packIds = operator.is_root ? null : await getOperatorPackIds(context, operator.id);

      const snapshot = await listInferenceJobs(context, {
        status: normalizedStatus,
        agent_id: query.agent_id,
        identity_id: query.identity_id,
        strategy: query.strategy,
        job_type: query.job_type,
        from_tick: query.from_tick,
        to_tick: query.to_tick,
        from_created_at: query.from_created_at,
        to_created_at: query.to_created_at,
        cursor: query.cursor,
        limit,
        has_error: hasError,
        action_intent_id: query.action_intent_id,
        pack_ids: packIds
      });

      jsonOk(res, toJsonSafe(snapshot), {
        pagination: snapshot.page_info
      });
    })
  );

  app.get(
    '/api/inference/ai-invocations',
    requireAuth(),
    deps.asyncHandler(async (req, res) => {
      context.assertRuntimeReady('ai invocation list');
      const query = parseQuery(aiInvocationsQuerySchema, req.query, 'AI_INVOCATION_QUERY_INVALID');
      const normalizedStatus = Array.isArray(query.status)
        ? query.status
        : typeof query.status === 'string'
          ? [query.status]
          : undefined;
      const limit = typeof query.limit === 'string' ? Number.parseInt(query.limit, 10) : undefined;
      const hasError = query.has_error === 'true' ? true : query.has_error === 'false' ? false : undefined;

      const snapshot = await listAiInvocations(context, {
        status: normalizedStatus,
        provider: query.provider,
        model: query.model,
        task_type: query.task_type,
        source_inference_id: query.source_inference_id,
        route_id: query.route_id,
        has_error: hasError,
        from_created_at: query.from_created_at,
        to_created_at: query.to_created_at,
        cursor: query.cursor,
        limit
      });

      jsonOk(res, toJsonSafe(snapshot), {
        pagination: snapshot.page_info
      });
    })
  );

  app.get('/api/inference/ai-invocations/:id', requireAuth(), deps.asyncHandler(async (req, res) => {
    context.assertRuntimeReady('ai invocation read');
    const params = parseParams(aiInvocationIdParamsSchema, req.params, 'AI_INVOCATION_QUERY_INVALID');
    const record = await getAiInvocationById(context, params.id);
    jsonOk(res, toJsonSafe(record));
  }));

  app.post(
    '/api/inference/jobs',
    requireAuth(),
    deps.asyncHandler(async (req, res) => {
      context.assertRuntimeReady('inference job submit');
      const input = parseBody(inferenceRequestSchema, req.body, 'INFERENCE_INPUT_INVALID');
      const result = await inferenceService.submitInferenceJob(input);

      jsonOk(res, toJsonSafe(result));
    })
  );

  app.post(
    '/api/inference/jobs/:id/retry',
    requireAuth(),
    deps.asyncHandler(async (req, res) => {
      context.assertRuntimeReady('inference job retry');
      const params = parseParams(inferenceJobIdParamsSchema, req.params, 'INFERENCE_INPUT_INVALID');
      const result = await inferenceService.retryInferenceJob(params.id);

      jsonOk(res, toJsonSafe(result));
    })
  );

  app.post(
    '/api/inference/jobs/:id/replay',
    requireAuth(),
    deps.asyncHandler(async (req, res) => {
      context.assertRuntimeReady('inference job replay');
      const params = parseParams(inferenceJobIdParamsSchema, req.params, 'INFERENCE_INPUT_INVALID');
      const body = parseBody(inferenceJobReplayRequestSchema, req.body, 'INFERENCE_INPUT_INVALID');
      const result = await inferenceService.replayInferenceJob(params.id, body);

      jsonOk(res, toJsonSafe(result));
    })
  );

  app.get(
    '/api/inference/traces/:id',
    requireAuth(),
    deps.asyncHandler(async (req, res) => {
      context.assertRuntimeReady('inference trace read');
      const params = parseParams(inferenceJobIdParamsSchema, req.params, 'INFERENCE_INPUT_INVALID');
      const trace = await getInferenceTraceById(context, params.id);

      jsonOk(res, toJsonSafe(trace));
    })
  );

  app.get(
    '/api/inference/traces/:id/intent',
    requireAuth(),
    deps.asyncHandler(async (req, res) => {
      context.assertRuntimeReady('action intent read');
      const params = parseParams(inferenceJobIdParamsSchema, req.params, 'INFERENCE_INPUT_INVALID');
      const intent = await getActionIntentByInferenceId(context, params.id);

      jsonOk(res, toJsonSafe(intent));
    })
  );

  app.get(
    '/api/inference/traces/:id/job',
    requireAuth(),
    deps.asyncHandler(async (req, res) => {
      context.assertRuntimeReady('decision job read');
      const params = parseParams(inferenceJobIdParamsSchema, req.params, 'INFERENCE_INPUT_INVALID');
      const job = await getDecisionJobByInferenceId(context, params.id);

      jsonOk(res, toJsonSafe(job));
    })
  );

  app.get(
    '/api/inference/traces/:id/workflow',
    requireAuth(),
    deps.asyncHandler(async (req, res) => {
      context.assertRuntimeReady('inference workflow read');
      const params = parseParams(inferenceJobIdParamsSchema, req.params, 'INFERENCE_INPUT_INVALID');
      const workflow = await getWorkflowSnapshotByInferenceId(context, params.id);

      jsonOk(res, toJsonSafe(workflow));
    })
  );

  app.get(
    '/api/inference/jobs/:id',
    requireAuth(),
    deps.asyncHandler(async (req, res) => {
      context.assertRuntimeReady('decision job read');
      const params = parseParams(inferenceJobIdParamsSchema, req.params, 'INFERENCE_INPUT_INVALID');
      const job = await getDecisionJobById(context, params.id);

      jsonOk(res, toJsonSafe(job));
    })
  );

  app.get(
    '/api/inference/jobs/:id/workflow',
    requireAuth(),
    deps.asyncHandler(async (req, res) => {
      context.assertRuntimeReady('decision workflow read');
      const params = parseParams(inferenceJobIdParamsSchema, req.params, 'INFERENCE_INPUT_INVALID');
      const workflow = await getWorkflowSnapshotByJobId(context, params.id);

      jsonOk(res, toJsonSafe(workflow));
    })
  );

  app.post(
    '/api/inference/stream',
    requireAuth(),
    deps.asyncHandler(async (req, res) => {
      context.assertRuntimeReady('inference stream');

      const streamRequestSchema = z.object({
        task_id: z.string().min(1),
        task_type: z.string().min(1),
        pack_id: z.string().nullish(),
        messages: z.array(z.object({
          role: z.enum(['system', 'developer', 'user', 'assistant', 'tool']),
          parts: z.array(z.union([
            z.object({ type: z.literal('text'), text: z.string() }),
            z.object({ type: z.literal('json'), json: z.record(z.string(), z.unknown()) }),
            z.object({ type: z.literal('image_url'), url: z.string() }),
            z.object({ type: z.literal('file_ref'), file_id: z.string(), mime_type: z.string().optional() })
          ])),
          name: z.string().optional(),
          metadata: z.record(z.string(), z.unknown()).optional()
        })),
        provider_hint: z.string().nullish(),
        model_hint: z.string().nullish(),
        response_mode: z.enum(['free_text', 'json_object', 'json_schema', 'tool_call']).default('free_text'),
        temperature: z.number().min(0).max(2).optional(),
        max_output_tokens: z.number().int().positive().optional(),
        structured_output_schema: z.record(z.string(), z.unknown()).optional(),
        tool_names: z.array(z.string()).optional(),
        tool_policy_mode: z.enum(['disabled', 'allowed', 'required']).optional()
      });

      const body = parseBody(streamRequestSchema, req.body, 'STREAM_INPUT_INVALID');

      const messages = body.messages as AiMessage[];
      const taskType = body.task_type as AiTaskType;
      const responseMode = body.response_mode as AiResponseMode;

      const taskConfig = resolveAiTaskConfig({ taskType });

      const taskRequest: AiTaskRequest = {
        task_id: body.task_id,
        task_type: taskType,
        pack_id: body.pack_id ?? null,
        input: {},
        prompt_context: { messages },
        output_contract: { mode: responseMode, json_schema: body.structured_output_schema },
        route_hints: { provider: body.provider_hint ?? undefined, model: body.model_hint ?? undefined },
        tools: body.tool_names?.map(name => ({ name, description: '', input_schema: {} })) ?? [],
        tool_policy: body.tool_policy_mode ? { mode: body.tool_policy_mode } : null
      };

      const gatewayRequest: ModelGatewayRequest = {
        invocation_id: randomUUID(),
        task_id: body.task_id,
        task_type: taskType,
        provider_hint: body.provider_hint ?? null,
        model_hint: body.model_hint ?? null,
        route_id: null,
        messages,
        response_mode: responseMode,
        structured_output: body.structured_output_schema
          ? { schema_name: `${taskType}_schema`, json_schema: body.structured_output_schema }
          : null,
        tools: body.tool_names?.map(name => ({ name, description: '', input_schema: {} })) ?? undefined,
        tool_policy: body.tool_policy_mode ? { mode: body.tool_policy_mode } : null,
        sampling: {
          temperature: body.temperature,
          max_output_tokens: body.max_output_tokens
        },
        execution: { timeout_ms: 60000, retry_limit: 0, allow_fallback: true }
      };

      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no'
      });

      const abortController = new AbortController();

      req.on('close', () => {
        abortController.abort();
      });

      try {
        const gateway = createModelGateway({ context });
        for await (const chunk of gateway.executeStream(
          { request: gatewayRequest, task_request: taskRequest, task_config: taskConfig },
          abortController.signal
        )) {
          res.write(`data: ${JSON.stringify(chunk)}\n\n`);
        }
        res.end();
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        res.write(`data: ${JSON.stringify({ type: 'error', code: 'STREAM_ERROR', message })}\n\n`);
        res.end();
      }
    })
  );
};
