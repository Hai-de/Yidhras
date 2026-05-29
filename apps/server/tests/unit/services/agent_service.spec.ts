import { describe, expect, it, vi } from 'vitest';

import { getAgentContextSnapshot, listSnrAdjustmentLogs } from '../../../src/app/services/agent/agent.js';
import { createMockAppContext } from '../../helpers/mock_context.js';

type FnMock = ReturnType<typeof vi.fn>;

const mockRepoMethod = <T>(obj: Record<string, unknown>, key: string, value: T): void => {
   
  (obj as Record<string, unknown>)[key] = vi.fn().mockResolvedValue(value) as FnMock;
};

/* ──────────────────── listSnrAdjustmentLogs ──────────────────── */

describe('listSnrAdjustmentLogs', () => {
  it('throws 400 for empty agent_id', async () => {
    const ctx = createMockAppContext();
    await expect(
      listSnrAdjustmentLogs(ctx as never, { agent_id: '' })
    ).rejects.toMatchObject({ code: 'SNR_LOG_QUERY_INVALID' });
  });

  it('throws 400 for whitespace-only agent_id', async () => {
    const ctx = createMockAppContext();
    await expect(
      listSnrAdjustmentLogs(ctx as never, { agent_id: '   ' })
    ).rejects.toMatchObject({ code: 'SNR_LOG_QUERY_INVALID' });
  });

  it('throws 400 for non-string agent_id', async () => {
    const ctx = createMockAppContext();
    await expect(
      listSnrAdjustmentLogs(ctx as never, { agent_id: undefined as never })
    ).rejects.toMatchObject({ code: 'SNR_LOG_QUERY_INVALID' });
  });

  it('returns logs with default limit when no limit provided', async () => {
    const ctx = createMockAppContext();
    const mockLogs = [
      { id: 'log1', agent_id: 'agent1', operation: 'adjust', requested_value: 50, resolved_value: 50, created_at: new Date() }
    ];
    mockRepoMethod(ctx.repos.relationship, 'listSnrAdjustmentLogs', mockLogs);

    const result = await listSnrAdjustmentLogs(ctx as never, { agent_id: 'agent1' });

    expect(result).toEqual(mockLogs);
     
    expect(ctx.repos.relationship.listSnrAdjustmentLogs as FnMock).toHaveBeenCalledWith({
      where: { agent_id: 'agent1' },
      orderBy: { created_at: 'desc' },
      take: 20 // DEFAULT_SNR_LOG_LIMIT
    });
  });

  it('clamps limit to MAX_SNR_LOG_LIMIT (100)', async () => {
    const ctx = createMockAppContext();
    mockRepoMethod(ctx.repos.relationship, 'listSnrAdjustmentLogs', []);

    await listSnrAdjustmentLogs(ctx as never, { agent_id: 'a1', limit: 999 });

     
    expect(ctx.repos.relationship.listSnrAdjustmentLogs as FnMock).toHaveBeenCalledWith(
      expect.objectContaining({ take: 100 })
    );
  });

  it('throws for limit of 0', async () => {
    const ctx = createMockAppContext();
    await expect(
      listSnrAdjustmentLogs(ctx as never, { agent_id: 'a1', limit: 0 })
    ).rejects.toMatchObject({ code: 'SNR_LOG_QUERY_INVALID' });
  });

  it('throws for negative limit', async () => {
    const ctx = createMockAppContext();
    await expect(
      listSnrAdjustmentLogs(ctx as never, { agent_id: 'a1', limit: -5 })
    ).rejects.toMatchObject({ code: 'SNR_LOG_QUERY_INVALID' });
  });

  it('throws for NaN limit', async () => {
    const ctx = createMockAppContext();
    await expect(
      listSnrAdjustmentLogs(ctx as never, { agent_id: 'a1', limit: Number.NaN })
    ).rejects.toMatchObject({ code: 'SNR_LOG_QUERY_INVALID' });
  });

  it('throws for Infinity limit', async () => {
    const ctx = createMockAppContext();
    await expect(
      listSnrAdjustmentLogs(ctx as never, { agent_id: 'a1', limit: Infinity })
    ).rejects.toMatchObject({ code: 'SNR_LOG_QUERY_INVALID' });
  });

  it('truncates fractional limit', async () => {
    const ctx = createMockAppContext();
    mockRepoMethod(ctx.repos.relationship, 'listSnrAdjustmentLogs', []);

    await listSnrAdjustmentLogs(ctx as never, { agent_id: 'a1', limit: 15.7 });

     
    expect(ctx.repos.relationship.listSnrAdjustmentLogs as FnMock).toHaveBeenCalledWith(
      expect.objectContaining({ take: 15 })
    );
  });

  it('uses exact limit within bounds', async () => {
    const ctx = createMockAppContext();
    mockRepoMethod(ctx.repos.relationship, 'listSnrAdjustmentLogs', []);

    await listSnrAdjustmentLogs(ctx as never, { agent_id: 'a1', limit: 50 });

     
    expect(ctx.repos.relationship.listSnrAdjustmentLogs as FnMock).toHaveBeenCalledWith(
      expect.objectContaining({ take: 50 })
    );
  });

  it('trims agent_id whitespace', async () => {
    const ctx = createMockAppContext();
    mockRepoMethod(ctx.repos.relationship, 'listSnrAdjustmentLogs', []);

    await listSnrAdjustmentLogs(ctx as never, { agent_id: '  agent1  ' });

     
    expect(ctx.repos.relationship.listSnrAdjustmentLogs as FnMock).toHaveBeenCalledWith(
      expect.objectContaining({ where: { agent_id: 'agent1' } })
    );
  });
});

/* ──────────────────── getAgentContextSnapshot ──────────────────── */

describe('getAgentContextSnapshot', () => {
  it('throws 404 when agent not found', async () => {
    const ctx = createMockAppContext();
    mockRepoMethod(ctx.repos.agent, 'findAgentByIdWithCircles', null);

    await expect(
      getAgentContextSnapshot(ctx as never, 'nonexistent')
    ).rejects.toMatchObject({ code: 'AGENT_NOT_FOUND' });
  });

  it('returns identity and empty variables when no pack host', async () => {
    const ctx = createMockAppContext();
    const mockAgent = {
      id: 'agent1',
      name: 'Agent One',
      type: 'actor',
      snr: 0.8,
      circles: []
    };
    mockRepoMethod(ctx.repos.agent, 'findAgentByIdWithCircles', mockAgent);

    const result = await getAgentContextSnapshot(ctx as never, 'agent1');

    expect(result.identity).toEqual(mockAgent);
    expect(result.variables).toEqual({});
  });

  it('returns pack variables when pack host provided', async () => {
    const ctx = createMockAppContext();
    const mockAgent = { id: 'agent1', name: 'Agent One' };
    mockRepoMethod(ctx.repos.agent, 'findAgentByIdWithCircles', mockAgent);

    const mockPack = {
      metadata: { id: 'pack1' },
      variables: { greeting: 'hello', trust: 70 }
    };
    const mockHost = {
      getPack: () => mockPack
    };

    const contextWithHost = {
      ...ctx,
      getPackRuntimeHost: vi.fn().mockReturnValue(mockHost)
    };

    const result = await getAgentContextSnapshot(contextWithHost as never, 'agent1', 'pack1');

    expect(contextWithHost.getPackRuntimeHost).toHaveBeenCalledWith('pack1');
    expect(result.variables).toEqual({ greeting: 'hello', trust: 70 });
  });

  it('returns empty variables when pack has no variables', async () => {
    const ctx = createMockAppContext();
    const mockAgent = { id: 'agent1', name: 'Agent One' };
    mockRepoMethod(ctx.repos.agent, 'findAgentByIdWithCircles', mockAgent);

    const mockHost = {
      getPack: () => ({ metadata: { id: 'pack1' } })
    };

    const contextWithHost = {
      ...ctx,
      getPackRuntimeHost: vi.fn().mockReturnValue(mockHost)
    };

    const result = await getAgentContextSnapshot(contextWithHost as never, 'agent1', 'pack1');

    expect(result.variables).toEqual({});
  });

  it('returns empty variables when host returns null', async () => {
    const ctx = createMockAppContext();
    const mockAgent = { id: 'agent1', name: 'Agent One' };
    mockRepoMethod(ctx.repos.agent, 'findAgentByIdWithCircles', mockAgent);

    const contextWithHost = {
      ...ctx,
      getPackRuntimeHost: vi.fn().mockReturnValue(null)
    };

    const result = await getAgentContextSnapshot(contextWithHost as never, 'agent1', 'pack1');

    expect(result.variables).toEqual({});
  });

  it('returns empty variables when no packId and no getPackRuntimeHost', async () => {
    const ctx = createMockAppContext();
    const mockAgent = { id: 'agent1', name: 'Agent One' };
    mockRepoMethod(ctx.repos.agent, 'findAgentByIdWithCircles', mockAgent);

    const result = await getAgentContextSnapshot(ctx as never, 'agent1');

    expect(result.variables).toEqual({});
  });
});
