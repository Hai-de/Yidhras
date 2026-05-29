import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/ai/gateway.js', () => ({
  createModelGateway: vi.fn(() => ({
    executeStream: vi.fn(async function* () {
      yield { type: 'chunk', content: 'test' };
    })
  }))
}));

vi.mock('../../../src/ai/task_definitions.js', () => ({
  resolveAiTaskConfig: vi.fn(() => ({
    task_id: 'test-task',
    task_type: 'agent_decision',
    provider_hint: null,
    model_hint: null
  }))
}));

vi.mock('../../../src/ai/prompt_bundle_from_messages.js', () => ({
  buildPromptBundleFromAiMessages: vi.fn(() => ({
    slots: {},
    slot_order: [],
    combined_prompt: '',
    metadata: { prompt_version: 'test', source_prompt_keys: [] },
    tree: {
      inference_id: 'test-inference',
      task_type: 'agent_decision',
      fragments_by_slot: {},
      slot_registry: {},
      resolved_positions: [],
      metadata: { prompt_version: 'test', profile_id: null, profile_version: null, source_prompt_keys: [] }
    }
  }))
}));

vi.mock('../../../src/app/services/inference_workflow.js', () => ({
  getActionIntentByInferenceId: vi.fn(async () => ({ id: 'intent-1' })),
  getAiInvocationById: vi.fn(async () => ({ id: 'invocation-1', status: 'completed' })),
  getDecisionJobById: vi.fn(async () => ({ id: 'job-1', status: 'completed' })),
  getDecisionJobByInferenceId: vi.fn(async () => ({ id: 'job-1', status: 'completed' })),
  getInferenceTraceById: vi.fn(async () => ({ id: 'trace-1', steps: [] })),
  getWorkflowSnapshotByInferenceId: vi.fn(async () => ({ id: 'snapshot-1' })),
  getWorkflowSnapshotByJobId: vi.fn(async () => ({ id: 'snapshot-1' })),
  listAiInvocations: vi.fn(async () => ({
    items: [],
    page_info: { has_next_page: false, next_cursor: null }
  })),
  listInferenceJobs: vi.fn(async () => ({
    items: [],
    page_info: { has_next_page: false, next_cursor: null }
  }))
}));

vi.mock('../../../src/app/services/operator/operator_pack_bindings.js', () => ({
  getOperatorPackIds: vi.fn(async () => ['pack-1'])
}));

const mockInferenceService = {
  previewInference: vi.fn(async () => ({
    inference_id: 'inf-1',
    status: 'completed',
    result: { text: 'preview result' }
  })),
  runInference: vi.fn(async () => ({
    inference_id: 'inf-2',
    status: 'completed',
    result: { text: 'run result' }
  })),
  submitInferenceJob: vi.fn(async () => ({
    job_id: 'job-1',
    status: 'pending'
  })),
  retryInferenceJob: vi.fn(async () => ({
    job_id: 'job-1',
    status: 'pending'
  })),
  replayInferenceJob: vi.fn(async () => ({
    job_id: 'job-2',
    status: 'pending'
  }))
};

import { createInferenceRoutes } from '../../../src/app/routes/inference.js';
import { createMockAppContext } from '../../helpers/mock_context.js';
import { createTestApp } from '../../helpers/test_app.js';

describe('inference routes', () => {
  const setup = () => {
    const ctx = createMockAppContext();
    const app = createTestApp(ctx, {
      operator: { id: 'op-1', username: 'admin', is_root: true }
    });
    const routes = createInferenceRoutes(mockInferenceService as never);
    routes.register(app.express, ctx);
    return { ctx, app };
  };

  describe('POST /api/inference/preview', () => {
    it('returns preview result for authorized operator', async () => {
      const { app } = setup();
      const res = await app.post('/api/inference/preview', {
        task_id: 'task-1',
        task_type: 'agent_decision',
        messages: [{ role: 'user', content: 'test' }]
      });

      expect(res.status).toBe(200);
      await app.close();
    });
  });

  describe('POST /api/inference/run', () => {
    it('returns run result for authorized operator', async () => {
      const { app } = setup();
      const res = await app.post('/api/inference/run', {
        task_id: 'task-1',
        task_type: 'agent_decision',
        messages: [{ role: 'user', content: 'test' }]
      });

      expect(res.status).toBe(200);
      await app.close();
    });
  });

  describe('GET /api/inference/jobs', () => {
    it('returns jobs list with pagination', async () => {
      const { app } = setup();
      const res = await app.get('/api/inference/jobs?status=pending&limit=10');

      expect(res.status).toBe(200);
      await app.close();
    });
  });

  describe('GET /api/inference/ai-invocations', () => {
    it('returns AI invocations list', async () => {
      const { app } = setup();
      const res = await app.get('/api/inference/ai-invocations?status=completed');

      expect(res.status).toBe(200);
      await app.close();
    });
  });

  describe('GET /api/inference/ai-invocations/:id', () => {
    it('returns specific AI invocation', async () => {
      const { app } = setup();
      const res = await app.get('/api/inference/ai-invocations/invocation-1');

      expect(res.status).toBe(200);
      await app.close();
    });
  });

  describe('POST /api/inference/jobs', () => {
    it('submits new inference job', async () => {
      const { app } = setup();
      const res = await app.post('/api/inference/jobs', {
        task_id: 'task-1',
        task_type: 'agent_decision',
        messages: [{ role: 'user', content: 'test' }]
      });

      expect(res.status).toBe(200);
      await app.close();
    });
  });

  describe('POST /api/inference/jobs/:id/retry', () => {
    it('retries inference job', async () => {
      const { app } = setup();
      const res = await app.post('/api/inference/jobs/job-1/retry');

      expect(res.status).toBe(200);
      await app.close();
    });
  });

  describe('POST /api/inference/jobs/:id/replay', () => {
    it('replays inference job', async () => {
      const { app } = setup();
      const res = await app.post('/api/inference/jobs/job-1/replay', {
        messages: [{ role: 'user', content: 'replay test' }]
      });

      expect(res.status).toBe(200);
      await app.close();
    });
  });

  describe('GET /api/inference/traces/:id', () => {
    it('returns inference trace', async () => {
      const { app } = setup();
      const res = await app.get('/api/inference/traces/trace-1');

      expect(res.status).toBe(200);
      await app.close();
    });
  });

  describe('GET /api/inference/traces/:id/intent', () => {
    it('returns action intent by inference ID', async () => {
      const { app } = setup();
      const res = await app.get('/api/inference/traces/trace-1/intent');

      expect(res.status).toBe(200);
      await app.close();
    });
  });

  describe('GET /api/inference/traces/:id/job', () => {
    it('returns decision job by inference ID', async () => {
      const { app } = setup();
      const res = await app.get('/api/inference/traces/trace-1/job');

      expect(res.status).toBe(200);
      await app.close();
    });
  });

  describe('GET /api/inference/traces/:id/workflow', () => {
    it('returns workflow snapshot by inference ID', async () => {
      const { app } = setup();
      const res = await app.get('/api/inference/traces/trace-1/workflow');

      expect(res.status).toBe(200);
      await app.close();
    });
  });

  describe('GET /api/inference/jobs/:id', () => {
    it('returns decision job by ID', async () => {
      const { app } = setup();
      const res = await app.get('/api/inference/jobs/job-1');

      expect(res.status).toBe(200);
      await app.close();
    });
  });

  describe('GET /api/inference/jobs/:id/workflow', () => {
    it('returns workflow snapshot by job ID', async () => {
      const { app } = setup();
      const res = await app.get('/api/inference/jobs/job-1/workflow');

      expect(res.status).toBe(200);
      await app.close();
    });
  });
});
