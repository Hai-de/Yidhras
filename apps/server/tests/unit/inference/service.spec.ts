import { describe, expect, it, vi } from 'vitest';

// Mock all heavy dependencies before import
vi.mock('../../../src/inference/context/builder.js', () => ({
  buildInferenceContext: vi.fn(async () => ({
    inference_id: 'inf-test-001',
    strategy: 'mock',
    tick: 1000n,
    actor_ref: { identity_id: 'id-1', identity_type: 'agent', role: 'active', agent_id: 'agent-1', atmosphere_node_id: null },
    binding_ref: null,
    resolved_agent_id: 'agent-1',
    world_pack: { instance_id: 'test-pack', metadata: { id: 'test-pack', name: 'Test Pack', version: '0.1.0' } },
    agent_snapshot: null,
    pack_state: { records: [] },
    latest_event: null,
    pack_artifacts: { manifests: [], slot_declarations: null },
    access_policy: { level: 'agent', granted: true },
    variable_context: { layers: [], visible: {} },
    agent_conversation_memory: null,
    current_agent_id: 'agent-1',
    identity: { id: 'id-1', type: 'agent', name: 'Test Agent', provider: 'local', status: 'active', claims: null },
    pack_runtime_contract: null
  })),
  ACTOR_ENTITY_ID_SEPARATOR: ':',
  packEntityIdFromResolvedAgentId: vi.fn(() => 'agent-1'),
  createPackScopedInferenceContextBuilder: vi.fn(() => ({ buildContextForPack: vi.fn() }))
}));

vi.mock('../../../src/context/workflow/orchestrator.js', () => ({
  buildWorkflowPromptBundle: vi.fn(async () => ({
    bundle: {
      slots: {},
      slot_order: [],
      combined_prompt: '',
      metadata: { prompt_version: 'v1', source_prompt_keys: [] },
      tree: {
        inference_id: 'inf-test-001',
        task_type: 'agent_decision',
        fragments_by_slot: {},
        slot_registry: {},
        resolved_positions: [],
        metadata: { prompt_version: 'v1', profile_id: null, profile_version: null, source_prompt_keys: [] }
      }
    }
  }))
}));

vi.mock('../../../src/conversation/compaction_audit.js', () => ({
  JsonlCompactionAuditStore: vi.fn()
}));

vi.mock('../../../src/conversation/compaction_service.js', () => ({
  DefaultConversationCompactionService: vi.fn()
}));

vi.mock('../../../src/conversation/format_config.js', () => ({
  resolveEffectiveFormatConfig: vi.fn(() => ({
    transcript: { mode: 'embed', turn_delimiter: '\n', speaker_format: { default: { prefix: '', suffix: '\n' } } },
    message_assembly: { merge_consecutive_same_role: true, slots: [], injection: { ai_fill_role: 'assistant', ai_fill_position: 'after_last_user' }, role_format: { system: { prefix: '', suffix: '' }, developer: { prefix: '', suffix: '' }, user: { prefix: '', suffix: '' }, assistant: { prefix: '', suffix: '' } } },
    compression: { enable_ai_summary: false, window_turns: 20, summary_trigger_turns: 30, preserve_recent: 5, compacted_target_role: 'system' }
  }))
}));

vi.mock('../../../src/conversation/profile_resolver.js', () => ({
  defaultProfileResolver: vi.fn(() => 'default')
}));

vi.mock('../../../src/conversation/writeback.js', () => ({
  writeConversationEntries: vi.fn(async () => {})
}));

vi.mock('../../../src/domain/invocation/intent_grounder.js', () => ({
  groundDecisionIntent: vi.fn(async () => ({
    decision: { action: 'speak', content: 'Hello!', confidence: 0.9 },
    raw_decision: { action: 'speak', content: 'Hello!' },
    grounding_source: 'mock'
  }))
}));

vi.mock('../../../src/memory/recording/service.js', () => ({
  createMemoryRecordingService: vi.fn(() => ({
    recordMemory: vi.fn(async () => {})
  }))
}));

vi.mock('../../../src/observability/metrics.js', () => ({
  recordInferenceCompleted: vi.fn(() => {})
}));

vi.mock('../../../src/app/services/inference_workflow.js', () => ({
  assertDecisionJobLockOwnership: vi.fn(),
  assertDecisionJobRetryable: vi.fn(),
  buildInferenceJobReplayResult: vi.fn(async () => ({ job_id: 'job-replay', status: 'pending' })),
  buildInferenceJobReplaySubmitResult: vi.fn(() => ({ job_id: 'job-replay', status: 'pending' })),
  buildInferenceJobRetryResult: vi.fn(() => ({ job_id: 'job-retry', status: 'pending' })),
  buildInferenceJobSubmitResult: vi.fn(() => ({ job_id: 'job-1', status: 'pending' })),
  buildReplayRequestInputFromJob: vi.fn(() => ({})),
  claimDecisionJob: vi.fn(async () => ({})),
  createPendingDecisionJob: vi.fn(async () => ({ id: 'job-1', status: 'pending', request_input: {} })),
  createReplayDecisionJob: vi.fn(async () => ({ id: 'job-replay', status: 'pending', request_input: {} })),
  DEFAULT_DECISION_JOB_LOCK_TICKS: 10n,
  getDecisionJobById: vi.fn(async () => ({ id: 'job-1', status: 'completed', request_input: {} })),
  getDecisionJobByIdempotencyKey: vi.fn(async () => null),
  getDecisionJobRequestInput: vi.fn(() => ({})),
  getWorkflowSnapshotByJobId: vi.fn(async () => null),
  normalizeReplayInput: vi.fn((input: unknown) => input ?? {}),
  releaseDecisionJobLock: vi.fn(async () => {}),
  updateDecisionJobState: vi.fn(async () => {})
}));

vi.mock('../../../src/app/services/pack/pack_runtime_ports.js', () => ({}));
vi.mock('../../../src/app/services/pack/pack_runtime_resolution.js', () => ({
  resolvePackTick: vi.fn(() => 1000n)
}));

vi.mock('../../../src/inference/prompt_bundle_v2.js', () => ({}));
vi.mock('../../../src/inference/prompt_tree.js', () => ({}));
vi.mock('../../../src/inference/provider.js', () => ({}));
vi.mock('../../../src/inference/trace_sink.js', () => ({}));

const mockContext = {
  assertRuntimeReady: vi.fn(),
  repos: { identityOperator: { findIdentityById: vi.fn(), listIdentityBindings: vi.fn() } },
  prisma: {},
  conversationStore: {
    getOrCreate: vi.fn(async () => ({ id: '', owner_agent_id: '', conversation_id: '', entries: [] })),
    getById: vi.fn(async () => null),
    listByAgent: vi.fn(async () => []),
    create: vi.fn(async () => ({ id: '', owner_agent_id: '', conversation_id: '', entries: [] })),
    appendEntry: vi.fn(async () => {}),
    appendEntriesInTransaction: vi.fn(async () => {}),
    modifyEntry: vi.fn(async () => {}),
    getEntries: vi.fn(async () => []),
    updateSummary: vi.fn(async () => {}),
    archiveEntries: vi.fn(async () => {}),
    deleteMemory: vi.fn(async () => {})
  },
  packRuntimeLookup: { hasPackRuntime: vi.fn(() => true), assertPackScope: vi.fn((id: string) => id), getPackRuntimeSummary: vi.fn(() => null) },
  contextAssembly: { getContext: vi.fn(async () => null), saveContext: vi.fn(async () => {}), listContexts: vi.fn(async () => []) },
  getPackRuntimeHost: vi.fn(() => ({
    getPack: vi.fn(() => ({ metadata: { id: 'test-pack', name: 'Test Pack', version: '0.1.0' } }))
  }))
};

const mockProvider = {
  name: 'mock-provider',
  strategies: ['mock'] as const,
  requiresPrompt: true,
  async run() {
    return {
      raw: { content: 'Hello from mock', finish_reason: 'stop' },
      text: 'Hello from mock',
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      finish_reason: 'stop',
      latency_ms: 100,
      provider_ref: 'mock-ref'
    };
  }
};

import { createInferenceService } from '../../../src/inference/service.js';

describe('inference service', () => {
  describe('createInferenceService', () => {
    it('returns a service with expected interface', () => {
      const service = createInferenceService({
        context: mockContext as never,
        providers: [mockProvider as never]
      });

      expect(service.phase).toBe('workflow_baseline');
      expect(service.ready).toBe(true);
      expect(typeof service.previewInference).toBe('function');
      expect(typeof service.runInference).toBe('function');
      expect(typeof service.submitInferenceJob).toBe('function');
      expect(typeof service.retryInferenceJob).toBe('function');
      expect(typeof service.replayInferenceJob).toBe('function');
      expect(typeof service.executeDecisionJob).toBe('function');
      expect(typeof service.buildActionIntentDraft).toBe('function');
    });

    it('previewInference returns inference metadata', async () => {
      const service = createInferenceService({
        context: mockContext as never,
        providers: [mockProvider as never]
      });

      const result = await service.previewInference({
        agent_id: 'agent-1',
        pack_id: 'test-pack',
        strategy: 'mock'
      } as never);

      expect(result.inference_id).toBe('inf-test-001');
      expect(result.strategy).toBe('mock');
      expect(result.provider).toBe('mock-provider');
      expect(result.tick).toBe('1000');
    });

    it('submitInferenceJob rejects without idempotency_key', async () => {
      const service = createInferenceService({
        context: mockContext as never,
        providers: [mockProvider as never]
      });

      await expect(service.submitInferenceJob({
        agent_id: 'agent-1',
        pack_id: 'test-pack',
        strategy: 'mock'
      } as never)).rejects.toThrow('idempotency_key is required');
    });

    it('submitInferenceJob succeeds with idempotency_key', async () => {
      const service = createInferenceService({
        context: mockContext as never,
        providers: [mockProvider as never]
      });

      const result = await service.submitInferenceJob({
        agent_id: 'agent-1',
        pack_id: 'test-pack',
        strategy: 'mock',
        idempotency_key: 'key-123'
      } as never);

      expect(result).toBeDefined();
    });

    it('buildActionIntentDraft returns intent draft', () => {
      const service = createInferenceService({
        context: mockContext as never,
        providers: [mockProvider as never]
      });

      const draft = service.buildActionIntentDraft(
        {
          action_type: 'speak',
          payload: { content: 'Hello!' },
          target_ref: null,
          confidence: 0.9,
          delay_hint_ticks: null
        } as never,
        'inf-001',
        {
          identity_id: 'id-1',
          identity_type: 'agent',
          role: 'active',
          agent_id: 'agent-1',
          atmosphere_node_id: null
        }
      );

      expect(draft).toBeDefined();
      expect(draft.source_inference_id).toBe('inf-001');
      expect(draft.intent_type).toBe('speak');
    });
  });
});
