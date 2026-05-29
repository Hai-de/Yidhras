import { describe, expect, it, vi } from 'vitest';

import type { AppInfrastructure } from '../../../src/app/context.js';
import type { InferenceActorRef } from '../../../src/inference/types.js';
import { buildShortTermMemory } from '../../../src/memory/short_term_adapter.js';

function makeActorRef(overrides: Partial<InferenceActorRef> = {}): InferenceActorRef {
  return {
    identity_id: 'id-1',
    identity_type: 'agent',
    role: 'active',
    agent_id: 'agent-1',
    atmosphere_node_id: null,
    ...overrides
  };
}

function makeMockContext(overrides: Record<string, unknown> = {}): AppInfrastructure {
  return {
    repos: {
      inference: {
        listInferenceTraces: vi.fn().mockResolvedValue([]),
        findDecisionJobs: vi.fn().mockResolvedValue([]),
        listActionIntents: vi.fn().mockResolvedValue([])
      },
      social: {
        queryPosts: vi.fn().mockResolvedValue([])
      },
      narrative: {
        queryEvents: vi.fn().mockResolvedValue([])
      }
    },
    ...overrides
  } as unknown as AppInfrastructure;
}

describe('memory/short_term_adapter', () => {
  describe('buildShortTermMemory', () => {
    it('should return empty entries when no data available', async () => {
      const ctx = makeMockContext();
      const result = await buildShortTermMemory(ctx, {
        actor_ref: makeActorRef(),
        resolved_agent_id: 'agent-1'
      });
      expect(result).toEqual([]);
    });

    it('should build trace memory entries', async () => {
      const trace = {
        id: 'trace-1',
        strategy: 'default',
        provider: 'openai',
        decision: { action: 'speak' },
        created_at: 100n,
        updated_at: 200n,
        actor_ref: { identity_id: 'id-1', agent_id: 'agent-1' }
      };
      const ctx = makeMockContext();
      (ctx.repos.inference.listInferenceTraces as ReturnType<typeof vi.fn>).mockResolvedValue([trace]);

      const result = await buildShortTermMemory(ctx, {
        actor_ref: makeActorRef(),
        resolved_agent_id: 'agent-1'
      });
      expect(result).toHaveLength(1);
      expect(result[0]!.id).toBe('mem-trace-trace-1');
      expect(result[0]!.scope).toBe('short_term');
      expect(result[0]!.source_kind).toBe('trace');
      expect(result[0]!.tags).toContain('trace');
      expect(result[0]!.tags).toContain('strategy:default');
      expect(result[0]!.importance).toBe(0.7);
    });

    it('should build job memory entries', async () => {
      const job = {
        id: 'job-1',
        status: 'completed',
        job_type: 'inference',
        last_error: null,
        created_at: 300n,
        updated_at: 400n,
        source_inference: { actor_ref: { identity_id: 'id-1', agent_id: 'agent-1' } },
        action_intent: null
      };
      const ctx = makeMockContext();
      (ctx.repos.inference.findDecisionJobs as ReturnType<typeof vi.fn>).mockResolvedValue([job]);

      const result = await buildShortTermMemory(ctx, {
        actor_ref: makeActorRef(),
        resolved_agent_id: 'agent-1'
      });
      expect(result).toHaveLength(1);
      expect(result[0]!.id).toBe('mem-job-job-1');
      expect(result[0]!.source_kind).toBe('job');
      expect(result[0]!.tags).toContain('job');
      expect(result[0]!.tags).toContain('job_status:completed');
      expect(result[0]!.importance).toBe(0.6);
    });

    it('should build job memory entry with high importance for failed jobs', async () => {
      const job = {
        id: 'job-2',
        status: 'failed',
        job_type: 'inference',
        last_error: 'timeout',
        last_error_stage: 'model_call',
        created_at: 500n,
        updated_at: 600n,
        source_inference: { actor_ref: { identity_id: 'id-1', agent_id: 'agent-1' } },
        action_intent: null
      };
      const ctx = makeMockContext();
      (ctx.repos.inference.findDecisionJobs as ReturnType<typeof vi.fn>).mockResolvedValue([job]);

      const result = await buildShortTermMemory(ctx, {
        actor_ref: makeActorRef(),
        resolved_agent_id: 'agent-1'
      });
      expect(result[0]!.importance).toBe(0.9);
      expect(result[0]!.salience).toBe(0.95);
      expect(result[0]!.content.text).toContain('timeout');
      expect(result[0]!.tags).toContain('failure:model_call');
    });

    it('should build intent memory entries', async () => {
      const intent = {
        id: 'intent-1',
        intent_type: 'move',
        status: 'dispatched',
        drop_reason: null,
        created_at: 700n,
        updated_at: 800n,
        actor_ref: { identity_id: 'id-1', agent_id: 'agent-1' }
      };
      const ctx = makeMockContext();
      (ctx.repos.inference.listActionIntents as ReturnType<typeof vi.fn>).mockResolvedValue([intent]);

      const result = await buildShortTermMemory(ctx, {
        actor_ref: makeActorRef(),
        resolved_agent_id: 'agent-1'
      });
      expect(result).toHaveLength(1);
      expect(result[0]!.id).toBe('mem-intent-intent-1');
      expect(result[0]!.source_kind).toBe('intent');
      expect(result[0]!.importance).toBe(0.6);
    });

    it('should build intent memory entry with high importance for failed/dropped intents', async () => {
      const intent = {
        id: 'intent-2',
        intent_type: 'attack',
        status: 'failed',
        drop_reason: null,
        dispatch_error_message: 'target not found',
        created_at: 900n,
        updated_at: 1000n,
        actor_ref: { identity_id: 'id-1', agent_id: 'agent-1' }
      };
      const ctx = makeMockContext();
      (ctx.repos.inference.listActionIntents as ReturnType<typeof vi.fn>).mockResolvedValue([intent]);

      const result = await buildShortTermMemory(ctx, {
        actor_ref: makeActorRef(),
        resolved_agent_id: 'agent-1'
      });
      expect(result[0]!.importance).toBe(0.85);
      expect(result[0]!.content.text).toContain('target not found');
    });

    it('should build post memory entries', async () => {
      const post = {
        id: 'post-1',
        author_id: 'agent-1',
        content: 'Hello world',
        created_at: 1100n
      };
      const ctx = makeMockContext();
      (ctx.repos.social.queryPosts as ReturnType<typeof vi.fn>).mockResolvedValue([post]);

      const result = await buildShortTermMemory(ctx, {
        actor_ref: makeActorRef(),
        resolved_agent_id: 'agent-1'
      });
      expect(result).toHaveLength(1);
      expect(result[0]!.id).toBe('mem-post-post-1');
      expect(result[0]!.source_kind).toBe('post');
      expect(result[0]!.content.text).toContain('Hello world');
    });

    it('should build event memory entries', async () => {
      const event = {
        id: 'evt-1',
        title: 'Event Title',
        description: 'Event happened',
        tick: 1200n,
        type: 'narrative'
      };
      const ctx = makeMockContext();
      (ctx.repos.narrative.queryEvents as ReturnType<typeof vi.fn>).mockResolvedValue([event]);

      const result = await buildShortTermMemory(ctx, {
        actor_ref: makeActorRef(),
        resolved_agent_id: 'agent-1'
      });
      expect(result).toHaveLength(1);
      expect(result[0]!.id).toBe('mem-event-evt-1');
      expect(result[0]!.source_kind).toBe('event');
      expect(result[0]!.tags).toContain('event_type:narrative');
    });

    it('should use default limit when not specified', async () => {
      const ctx = makeMockContext();
      await buildShortTermMemory(ctx, {
        actor_ref: makeActorRef(),
        resolved_agent_id: 'agent-1'
      });
      // Default limit is 10, so listInferenceTraces should be called with take: 30
      expect(ctx.repos.inference.listInferenceTraces).toHaveBeenCalledWith({
        orderBy: { updated_at: 'desc' },
        take: 30
      });
    });

    it('should use custom limit when specified', async () => {
      const ctx = makeMockContext();
      await buildShortTermMemory(ctx, {
        actor_ref: makeActorRef(),
        resolved_agent_id: 'agent-1',
        limit: 5
      });
      expect(ctx.repos.inference.listInferenceTraces).toHaveBeenCalledWith({
        orderBy: { updated_at: 'desc' },
        take: 15
      });
    });

    it('should skip post query when resolved_agent_id is null', async () => {
      const ctx = makeMockContext();
      await buildShortTermMemory(ctx, {
        actor_ref: makeActorRef(),
        resolved_agent_id: null
      });
      expect(ctx.repos.social.queryPosts).not.toHaveBeenCalled();
    });
  });
});
