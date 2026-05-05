import { describe, expect, it } from 'vitest';

import type { ModelGateway, ModelGatewayExecutionInput } from '../../../src/ai/gateway.js';
import type {
  AiResolvedTaskConfig,
  ModelGatewayResponse,
  AiTaskDefinition
} from '../../../src/ai/types.js';
import { runCompactionInference } from '../../../src/conversation/compaction_inference.js';
import type { ConversationEntry } from '../../../src/conversation/types.js';

function makeEntry(overrides: Partial<ConversationEntry> = {}): ConversationEntry {
  return {
    id: `entry-${Math.random().toString(36).slice(2, 8)}`,
    turn_number: 1,
    speaker_agent_id: 'agent-a',
    kind: 'original',
    original_content: 'Hello world.',
    current_content: 'Hello world.',
    provenance: {
      operator: { kind: 'agent', id: 'agent-a' },
      capability: 'conversation.record'
    },
    recorded_at: Date.now(),
    modifications: [],
    ...overrides
  };
}

function makeTaskConfig(): AiResolvedTaskConfig {
  return {
    definition: {
      task_type: 'context_summary',
      category: 'server',
      description: 'test',
      default_prompt_preset: 'compaction',
      default_response_mode: 'free_text',
      timeout_ms: 60000,
      retry_limit: 1,
      allow_fallback: true
    } as AiTaskDefinition,
    override: null,
    output: { mode: 'free_text' },
    prompt: {},
    parse: {},
    route: {},
    tools: [],
    tool_policy: { allow: [], require_approval: [] }
  };
}

function makeSuccessResponse(overrides: Partial<ModelGatewayResponse> = {}): ModelGatewayResponse {
  return {
    invocation_id: 'inv-1',
    task_id: 'task-1',
    task_type: 'context_summary',
    provider: 'mock',
    model: 'mock-model',
    route_id: null,
    fallback_used: false,
    attempted_models: ['mock-model'],
    status: 'completed',
    finish_reason: 'stop',
    output: {
      mode: 'free_text',
      text: 'This is a summary of the conversation.',
      json: null,
      tool_calls: []
    },
    usage: {
      input_tokens: 100,
      output_tokens: 50,
      total_tokens: 150
    },
    ...overrides
  };
}

function createMockGateway(response: ModelGatewayResponse): ModelGateway {
  return {
    execute: async (_input: ModelGatewayExecutionInput) => response
  };
}

describe('runCompactionInference', () => {
  it('returns summary text on success', async () => {
    const gateway = createMockGateway(makeSuccessResponse());
    const entries = [makeEntry(), makeEntry({ turn_number: 2, current_content: 'Second message.' })];

    const result = await runCompactionInference({
      entries,
      agentId: 'agent-a',
      conversationId: 'conv-1',
      gateway,
      taskConfig: makeTaskConfig()
    });

    expect(result.summaryText).toBe('This is a summary of the conversation.');
    expect(result.model).toBe('mock-model');
    expect(result.promptTokens).toBe(100);
    expect(result.completionTokens).toBe(50);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('throws when gateway returns failed status', async () => {
    const gateway = createMockGateway(
      makeSuccessResponse({ status: 'failed', output: { mode: 'free_text', text: '' } })
    );

    await expect(
      runCompactionInference({
        entries: [makeEntry()],
        agentId: 'agent-a',
        conversationId: 'conv-1',
        gateway,
        taskConfig: makeTaskConfig()
      })
    ).rejects.toThrow('Compaction inference failed');
  });

  it('throws when response has no output text', async () => {
    const gateway = createMockGateway(
      makeSuccessResponse({ output: { mode: 'free_text', text: '' } })
    );

    await expect(
      runCompactionInference({
        entries: [makeEntry()],
        agentId: 'agent-a',
        conversationId: 'conv-1',
        gateway,
        taskConfig: makeTaskConfig()
      })
    ).rejects.toThrow('Compaction inference failed');
  });

  it('constructs prompt with system + user messages', async () => {
    let capturedMessages: unknown = null;
    const gateway: ModelGateway = {
      execute: async (input: ModelGatewayExecutionInput) => {
        capturedMessages = input.request.messages;
        return makeSuccessResponse();
      }
    };

    const entries = [
      makeEntry({ turn_number: 1, speaker_agent_id: 'alice', current_content: 'Hi there.' }),
      makeEntry({ turn_number: 2, speaker_agent_id: 'bob', current_content: 'Hello!' })
    ];

    await runCompactionInference({
      entries,
      agentId: 'alice',
      conversationId: 'conv-1',
      gateway,
      taskConfig: makeTaskConfig()
    });

    const messages = capturedMessages as Array<{ role: string; parts: Array<{ text: string }> }>;
    expect(messages).toHaveLength(2);
    expect(messages[0].role).toBe('system');
    expect(messages[1].role).toBe('user');
    expect(messages[1].parts[0].text).toContain('alice');
    expect(messages[1].parts[0].text).toContain('bob');
    expect(messages[1].parts[0].text).toContain('Hi there.');
    expect(messages[1].parts[0].text).toContain('Hello!');
  });

  it('prompt does not contain conversation_history or persona references', async () => {
    let capturedRequest: ModelGatewayExecutionInput['request'] | null = null;
    const gateway: ModelGateway = {
      execute: async (input: ModelGatewayExecutionInput) => {
        capturedRequest = input.request;
        return makeSuccessResponse();
      }
    };

    await runCompactionInference({
      entries: [makeEntry()],
      agentId: 'agent-a',
      conversationId: 'conv-1',
      gateway,
      taskConfig: makeTaskConfig()
    });

    const request = capturedRequest!;
    expect(request.tools).toBeUndefined();
    expect(request.response_mode).toBe('free_text');

    const messageTexts = request.messages.map((m) =>
      m.parts.map((p) => ('text' in p ? p.text : '')).join(' ')
    );
    const allText = messageTexts.join(' ');
    expect(allText).not.toContain('conversation_history');
    expect(allText).not.toContain('persona');
    expect(allText).not.toContain('{{system_core}}');
  });

  it('sorts entries by turn_number in prompt', async () => {
    let capturedRequest: ModelGatewayExecutionInput['request'] | null = null;
    const gateway: ModelGateway = {
      execute: async (input: ModelGatewayExecutionInput) => {
        capturedRequest = input.request;
        return makeSuccessResponse();
      }
    };

    const entries = [
      makeEntry({ turn_number: 3, current_content: 'Third.' }),
      makeEntry({ turn_number: 1, current_content: 'First.' }),
      makeEntry({ turn_number: 2, current_content: 'Second.' })
    ];

    await runCompactionInference({
      entries,
      agentId: 'agent-a',
      conversationId: 'conv-1',
      gateway,
      taskConfig: makeTaskConfig()
    });

    const userMsg = capturedRequest!.messages[1];
    const text = userMsg.parts.map((p) => ('text' in p ? p.text : '')).join(' ');
    const firstIdx = text.indexOf('First.');
    const secondIdx = text.indexOf('Second.');
    const thirdIdx = text.indexOf('Third.');
    expect(firstIdx).toBeLessThan(secondIdx);
    expect(secondIdx).toBeLessThan(thirdIdx);
  });
});
