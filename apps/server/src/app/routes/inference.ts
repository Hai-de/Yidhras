import type { Express, NextFunction, Request, Response } from 'express';

import type { InferenceService } from '../../inference/service.js';
import type { InferenceJobReplayInput, InferenceRequestInput } from '../../inference/types.js';
import type { AppContext } from '../context.js';
import { toJsonSafe } from '../http/json.js';
import {
  getActionIntentByInferenceId,
  getDecisionJobById,
  getDecisionJobByInferenceId,
  getInferenceTraceById,
  getWorkflowSnapshotByInferenceId,
  getWorkflowSnapshotByJobId
} from '../services/inference_workflow.js';

export interface InferenceRouteDependencies {
  asyncHandler(
    handler: (req: Request, res: Response, next: NextFunction) => Promise<void>
  ): (req: Request, res: Response, next: NextFunction) => void;
}

const parseInferenceInput = (body: unknown): InferenceRequestInput => {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return {};
  }

  const record = body as Record<string, unknown>;
  return {
    agent_id: typeof record.agent_id === 'string' ? record.agent_id : undefined,
    identity_id: typeof record.identity_id === 'string' ? record.identity_id : undefined,
    strategy: record.strategy as InferenceRequestInput['strategy'],
    attributes: record.attributes as InferenceRequestInput['attributes'],
    idempotency_key: typeof record.idempotency_key === 'string' ? record.idempotency_key : undefined
  };
};

const parseReplayInput = (body: unknown): InferenceJobReplayInput => {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return {};
  }

  const record = body as Record<string, unknown>;
  const overrides = record.overrides as Record<string, unknown> | undefined;

  return {
    reason: typeof record.reason === 'string' ? record.reason : undefined,
    idempotency_key: typeof record.idempotency_key === 'string' ? record.idempotency_key : undefined,
    overrides:
      overrides && typeof overrides === 'object' && !Array.isArray(overrides)
        ? {
            strategy: overrides.strategy as NonNullable<InferenceJobReplayInput['overrides']>['strategy'],
            attributes: overrides.attributes as Record<string, unknown> | undefined,
            agent_id: typeof overrides.agent_id === 'string' ? overrides.agent_id :undefined,
            identity_id: typeof overrides.identity_id === 'string' ? overrides.identity_id : undefined
          }
        : undefined
  };
};

export const registerInferenceRoutes = (
  app: Express,
  context: AppContext,
  inferenceService: InferenceService,
  deps: InferenceRouteDependencies
): void => {
  app.post(
    '/api/inference/preview',
    deps.asyncHandler(async (req, res) => {
      context.assertRuntimeReady('inference preview');
      const input = parseInferenceInput(req.body);
      const result = await inferenceService.previewInference(input);

      res.json({
        success: true,
        data: result
      });
    })
  );

  app.post(
    '/api/inference/run',
    deps.asyncHandler(async (req, res) => {
      context.assertRuntimeReady('inference run');
      const input = parseInferenceInput(req.body);
      const result = await inferenceService.runInference(input);

      res.json({
        success: true,
        data: result
      });
    })
  );

  app.post(
    '/api/inference/jobs',
    deps.asyncHandler(async (req, res) => {
      context.assertRuntimeReady('inference job submit');
      const input = parseInferenceInput(req.body);
      const result = await inferenceService.submitInferenceJob(input);

      res.json({
        success: true,
        data: result
      });
    })
  );

  app.post(
    '/api/inference/jobs/:id/retry',
    deps.asyncHandler(async (req, res) => {
      context.assertRuntimeReady('inference job retry');
      const result = await inferenceService.retryInferenceJob(req.params.id);

      res.json({
        success: true,
        data: result
      });
    })
  );

  app.post(
    '/api/inference/jobs/:id/replay',
    deps.asyncHandler(async (req, res) => {
      context.assertRuntimeReady('inference job replay');
      const result = await inferenceService.replayInferenceJob(req.params.id, parseReplayInput(req.body));

      res.json({
        success: true,
        data: result
      });
    })
  );

  app.get(
    '/api/inference/traces/:id',
    deps.asyncHandler(async (req, res) => {
      context.assertRuntimeReady('inference trace read');
      const trace = await getInferenceTraceById(context, req.params.id);

      res.json({
        success: true,
        data: toJsonSafe(trace)
      });
    })
  );

  app.get(
    '/api/inference/traces/:id/intent',
    deps.asyncHandler(async (req, res) => {
      context.assertRuntimeReady('action intent read');
      const intent = await getActionIntentByInferenceId(context, req.params.id);

      res.json({
        success: true,
        data: toJsonSafe(intent)
      });
    })
  );

  app.get(
    '/api/inference/traces/:id/job',
    deps.asyncHandler(async (req, res) => {
      context.assertRuntimeReady('decision job read');
      const job = await getDecisionJobByInferenceId(context, req.params.id);

      res.json({
        success: true,
        data: toJsonSafe(job)
      });
    })
  );

  app.get(
    '/api/inference/traces/:id/workflow',
    deps.asyncHandler(async (req, res) => {
      context.assertRuntimeReady('inference workflow read');
      const workflow = await getWorkflowSnapshotByInferenceId(context, req.params.id);

      res.json({
        success: true,
        data: workflow
      });
    })
  );

  app.get(
    '/api/inference/jobs/:id',
    deps.asyncHandler(async (req, res) => {
      context.assertRuntimeReady('decision job read');
      const job = await getDecisionJobById(context, req.params.id);

      res.json({
        success: true,
        data: toJsonSafe(job)
      });
    })
  );

  app.get(
    '/api/inference/jobs/:id/workflow',
    deps.asyncHandler(async (req, res) => {
      context.assertRuntimeReady('decision workflow read');
      const workflow = await getWorkflowSnapshotByJobId(context, req.params.id);

      res.json({
        success: true,
        data: workflow
      });
    })
  );
};
