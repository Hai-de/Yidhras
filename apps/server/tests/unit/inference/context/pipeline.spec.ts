import { describe, expect, it, vi } from 'vitest';

import { ContextAssemblyPipeline } from '../../../../src/inference/context/pipeline.js';
import type { InferenceRequestInput } from '../../../../src/inference/types.js';
import { makeMockAppInfrastructure, makeMockPackRuntimeHost, makeMockPackStorageAdapter } from '../../../helpers/inference-mocks.js';
import { createMockPrisma } from '../../../helpers/prisma_mock.js';

const baseInput: InferenceRequestInput & { pack_id: string } = {
  agent_id: 'agent-1',
  pack_id: 'test-pack',
  strategy: 'mock' as const,
  attributes: { role: 'player' },
  idempotency_key: 'ik-1'
};

function makePipelineCtx(overrides?: {
  prisma?: ReturnType<typeof createMockPrisma>;
}) {
  const prisma = overrides?.prisma ?? createMockPrisma();

  // Default: agent exists, identity exists (system), no events
  prisma.agent.findUnique.mockResolvedValue({
    id: 'agent-1',
    name: 'Test Agent',
    type: 'agent',
    snr: 0.8,
    is_pinned: false,
    created_at: 0n,
    updated_at: 0n,
    circle_memberships: []
  });
  prisma.identity.findUnique.mockResolvedValue({
    id: 'system',
    type: 'system',
    name: 'Yidhras',
    provider: null,
    status: null,
    claims: null
  });
  prisma.identityNodeBinding.findMany.mockResolvedValue([]);
  prisma.identityNodeBinding.findFirst.mockResolvedValue(null);
  prisma.policy.findMany.mockResolvedValue([]);
  prisma.event.findFirst.mockResolvedValue(null);
  prisma.event.findMany.mockResolvedValue([]);
  // For $transaction
  prisma.$transaction.mockImplementation(
    async (arg: unknown): Promise<unknown> => {
      if (typeof arg === 'function') {
        return (arg as (tx: unknown) => unknown)(prisma);
      }
      return [];
    }
  );

  const host = makeMockPackRuntimeHost({
    packOverrides: {
      metadata: { id: 'test-pack', name: 'Test Pack', version: '0.1.0' }
    }
  });

  const adapter = makeMockPackStorageAdapter({
    entityStateRows: [],
    tableRows: {
      authority_grants: [],
      world_entities: [],
      mediator_bindings: []
    }
  });

  const infra = makeMockAppInfrastructure({
    prisma,
    packStorageAdapter: adapter,
    getPackRuntimeHost: host.getPackRuntimeHost
  });

  return {
    ...infra,
    packRuntimeLookup: {
      hasPackRuntime: vi.fn(() => true),
      assertPackScope: vi.fn((id: string) => id),
      getPackRuntimeSummary: vi.fn(() => null)
    },
    contextAssembly: {
      buildContextRun: vi.fn(async () => ({
        context_run: { run_id: 'run-1', tick: 1000n },
        memory_context: { recent: [], relevant: [] }
      }))
    }
  };
}

describe('ContextAssemblyPipeline', () => {
  // ── Full pipeline execution ───────────────────────────────
  describe('full pipeline execution', () => {
    it('returns InferenceContext with all fields populated', async () => {
      const ctx = makePipelineCtx();
      const pipeline = new ContextAssemblyPipeline();

      const result = await pipeline.execute(ctx, baseInput);

      expect(result).toBeDefined();
      // Core identifiers
      expect(result.inference_id).toBeTruthy();
      expect(typeof result.inference_id).toBe('string');
      expect(result.actor_ref).toBeDefined();
      expect(result.actor_ref.agent_id).toBe('agent-1');
      expect(result.actor_ref.role).toBe('active');
      expect(result.actor_display_name).toBe('Test Agent');
      expect(result.identity).toBeDefined();
      expect(result.binding_ref).toBeNull();
      expect(result.resolved_agent_id).toBe('agent-1');

      // World pack info
      expect(result.world_pack.instance_id).toBe('test-pack');
      expect(result.world_pack.name).toBe('Test Pack');

      // Strategy and attributes
      expect(result.strategy).toBe('mock');
      expect(result.attributes).toEqual({ role: 'player' });
      expect(result.agent_capabilities).toEqual([]);

      // Pack state
      expect(result.pack_state).toBeDefined();
      expect(result.pack_state.actor_state).toBeNull();
      expect(result.pack_state.world_state).toBeNull();
      expect(result.pack_state.latest_event).toBeNull();

      // Policy summary
      expect(result.policy_summary).toBeDefined();

      // Transmission profile
      expect(result.transmission_profile).toBeDefined();
      expect(result.transmission_profile.policy).toBeDefined();

      // Variable context
      expect(result.visible_variables).toBeDefined();
      expect(result.variable_context).toBeDefined();
      expect(result.variable_context.layers.length).toBeGreaterThan(0);

      // Context run
      expect(result.context_run).toBeDefined();
      expect(result.memory_context).toBeDefined();
    });

    it('calls contextAssembly.buildContextRun during execution', async () => {
      const ctx = makePipelineCtx();
      const pipeline = new ContextAssemblyPipeline();

      await pipeline.execute(ctx, baseInput);

      expect(ctx.contextAssembly.buildContextRun).toHaveBeenCalledTimes(1);
      const callArgs = ctx.contextAssembly.buildContextRun.mock.calls[0][0] as Record<string, unknown>;
      expect(callArgs.actor_ref).toBeDefined();
      expect(callArgs.pack_id).toBe('test-pack');
    });
  });

  // ── Actor resolution failure ──────────────────────────────
  describe('actor resolution failure', () => {
    it('throws when getPackRuntimeHost returns null for pack', async () => {
      const prisma = createMockPrisma();
      prisma.event.findFirst.mockResolvedValue(null);
      prisma.event.findMany.mockResolvedValue([]);
      prisma.$transaction.mockImplementation(async (arg: unknown) => {
        if (typeof arg === 'function') return (arg as (tx: unknown) => unknown)(prisma);
        return [];
      });

      const host = makeMockPackRuntimeHost();
      // Override to return null for the specific pack
      host.getPackRuntimeHost.mockReturnValue(null);

      const infra = makeMockAppInfrastructure({
        prisma,
        getPackRuntimeHost: host.getPackRuntimeHost
      });

      const ctx = {
        ...infra,
        packRuntimeLookup: {
          hasPackRuntime: vi.fn(() => false),
          assertPackScope: vi.fn((id: string) => id),
          getPackRuntimeSummary: vi.fn(() => null)
        }
      };

      const pipeline = new ContextAssemblyPipeline();

      await expect(
        pipeline.execute(ctx, baseInput)
      ).rejects.toThrow('World pack not ready for inference context');
    });

    it('throws AGENT_NOT_FOUND when agent does not exist', async () => {
      const prisma = createMockPrisma();
      prisma.agent.findUnique.mockResolvedValue(null); // agent not found
      prisma.identity.findUnique.mockResolvedValue(null); // system identity not found
      prisma.event.findFirst.mockResolvedValue(null);
      prisma.event.findMany.mockResolvedValue([]);
      prisma.$transaction.mockImplementation(async (arg: unknown) => {
        if (typeof arg === 'function') return (arg as (tx: unknown) => unknown)(prisma);
        return [];
      });

      const host = makeMockPackRuntimeHost();
      const adapter = makeMockPackStorageAdapter({
        tableRows: { authority_grants: [], world_entities: [], mediator_bindings: [] }
      });

      const infra = makeMockAppInfrastructure({
        prisma,
        packStorageAdapter: adapter,
        getPackRuntimeHost: host.getPackRuntimeHost
      });

      const ctx = {
        ...infra,
        packRuntimeLookup: {
          hasPackRuntime: vi.fn(() => true),
          assertPackScope: vi.fn((id: string) => id),
          getPackRuntimeSummary: vi.fn(() => null)
        }
      };

      const pipeline = new ContextAssemblyPipeline();

      await expect(
        pipeline.execute(ctx, { ...baseInput, agent_id: 'nonexistent' })
      ).rejects.toThrow('Agent not found');
    });
  });

  // ── State snapshot graceful failure ────────────────────────
  describe('state snapshot handling', () => {
    it('continues execution when listEngineOwnedRecords returns empty', async () => {
      const ctx = makePipelineCtx();
      const pipeline = new ContextAssemblyPipeline({ graceful: true });

      const result = await pipeline.execute(ctx, baseInput);

      // Should not throw — pack_state is empty but pipeline continues
      expect(result.pack_state).toBeDefined();
      expect(result.pack_state.actor_state).toBeNull();
    });

    it('survives empty pack state gracefully', async () => {
      const prisma = createMockPrisma();
      prisma.agent.findUnique.mockResolvedValue({
        id: 'agent-1',
        name: 'Survivor',
        type: 'agent',
        snr: 0.5,
        is_pinned: false,
        created_at: 0n,
        updated_at: 0n,
        circle_memberships: []
      });
      prisma.identity.findUnique.mockResolvedValue({
        id: 'system',
        type: 'system',
        name: 'Yidhras',
        provider: null,
        status: null,
        claims: null
      });
      prisma.identityNodeBinding.findMany.mockResolvedValue([]);
      prisma.identityNodeBinding.findFirst.mockResolvedValue(null);
      prisma.policy.findMany.mockResolvedValue([]);
      prisma.event.findFirst.mockResolvedValue(null);
      prisma.event.findMany.mockResolvedValue([]);
      prisma.$transaction.mockImplementation(async (arg: unknown) => {
        if (typeof arg === 'function') return (arg as (tx: unknown) => unknown)(prisma);
        return [];
      });

      const host = makeMockPackRuntimeHost();
      const adapter = makeMockPackStorageAdapter({
        entityStateRows: [],
        tableRows: { authority_grants: [], world_entities: [], mediator_bindings: [] }
      });

      const infra = makeMockAppInfrastructure({
        prisma,
        packStorageAdapter: adapter,
        getPackRuntimeHost: host.getPackRuntimeHost
      });

      const ctx = {
        ...infra,
        packRuntimeLookup: {
          hasPackRuntime: vi.fn(() => true),
          assertPackScope: vi.fn((id: string) => id),
          getPackRuntimeSummary: vi.fn(() => null)
        },
        contextAssembly: {
          buildContextRun: vi.fn(async () => ({
            context_run: { run_id: 'run-1' },
            memory_context: { recent: [], relevant: [] }
          }))
        }
      };

      const pipeline = new ContextAssemblyPipeline();

      const result = await pipeline.execute(ctx, baseInput);

      expect(result).toBeDefined();
      expect(result.pack_state.actor_state).toBeNull();
    });
  });

  // ── Strategy selection ────────────────────────────────────
  describe('strategy selection', () => {
    it('defaults to mock strategy', async () => {
      const ctx = makePipelineCtx();
      const pipeline = new ContextAssemblyPipeline();

      const result = await pipeline.execute(ctx, { ...baseInput, strategy: undefined as unknown });

      expect(result.strategy).toBe('mock');
    });

    it('rejects unsupported strategy', async () => {
      const ctx = makePipelineCtx();
      const pipeline = new ContextAssemblyPipeline();

      await expect(
        pipeline.execute(ctx, { ...baseInput, strategy: 'unsupported' as never })
      ).rejects.toThrow('strategy is not supported');
    });

    it('passes through model_routed strategy', async () => {
      const ctx = makePipelineCtx();
      const pipeline = new ContextAssemblyPipeline();

      const result = await pipeline.execute(ctx, { ...baseInput, strategy: 'model_routed' });

      expect(result.strategy).toBe('model_routed');
    });
  });

  // ── Attributes normalization ──────────────────────────────
  describe('attributes normalization', () => {
    it('defaults empty attributes to {}', async () => {
      const ctx = makePipelineCtx();
      const pipeline = new ContextAssemblyPipeline();

      const result = await pipeline.execute(ctx, { ...baseInput, attributes: undefined as unknown });

      expect(result.attributes).toEqual({});
    });

    it('rejects array attributes', async () => {
      const ctx = makePipelineCtx();
      const pipeline = new ContextAssemblyPipeline();

      await expect(
        pipeline.execute(ctx, { ...baseInput, attributes: ['bad'] as unknown })
      ).rejects.toThrow('attributes must be an object');
    });
  });
});
