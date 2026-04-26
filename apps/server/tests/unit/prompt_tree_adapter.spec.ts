import { describe, expect, it } from 'vitest';

import { adaptPromptTreeToAiMessages } from '../../src/ai/adapters/prompt_tree_adapter.js';
import type { AiResolvedTaskConfig } from '../../src/ai/types.js';
import type { PromptBundleV2 } from '../../src/inference/prompt_bundle_v2.js';
import type { PromptSlotConfig } from '../../src/inference/prompt_slot_config.js';

describe('adaptPromptTreeToAiMessages', () => {
  const BASE_SLOT_REGISTRY: Record<string, unknown> = {
    system_core: {
      id: 'system_core',
      display_name: 'System Core',
      default_priority: 100,
      message_role: 'system',
      include_in_combined: true,
      combined_heading: 'System Prompt',
      enabled: true
    },
    system_policy: {
      id: 'system_policy',
      display_name: 'System Policy',
      default_priority: 95,
      message_role: 'system',
      include_in_combined: true,
      combined_heading: 'System Policy Prompt',
      enabled: true
    },
    role_core: {
      id: 'role_core',
      display_name: 'Role Core',
      default_priority: 90,
      message_role: 'developer',
      include_in_combined: true,
      combined_heading: 'Role Prompt',
      enabled: true
    },
    post_process: {
      id: 'post_process',
      display_name: 'Post Process',
      default_priority: 60,
      message_role: 'user',
      include_in_combined: true,
      combined_heading: null,
      enabled: true
    },
    output_contract: {
      id: 'output_contract',
      display_name: 'Output Contract',
      default_priority: 50,
      message_role: 'user',
      include_in_combined: true,
      combined_heading: 'Output Contract',
      enabled: true
    }
  };

  const createV2Bundle = (slots: Record<string, string>, registryOverrides?: Record<string, unknown>): PromptBundleV2 => ({
    slots,
    combined_prompt: Object.values(slots).join('\n\n'),
    metadata: {
      prompt_version: 'phase-c-v1',
      source_prompt_keys: Object.keys(slots),
      workflow_task_type: 'agent_decision',
      workflow_profile_id: 'agent-decision-default',
      workflow_profile_version: '1',
      workflow_step_keys: ['memory_projection', 'placement_resolution']
    },
    tree: {
      inference_id: 'inf-test',
      task_type: 'agent_decision',
      fragments_by_slot: {},
      slot_registry: (registryOverrides ?? BASE_SLOT_REGISTRY) as Record<string, PromptSlotConfig>,
      metadata: {
        prompt_version: 'phase-c-v1',
        profile_id: null,
        profile_version: null,
        source_prompt_keys: Object.keys(slots)
      }
    }
  });

  const TEST_TASK_CONFIG: AiResolvedTaskConfig = {
    definition: { task_type: 'agent_decision', default_response_mode: 'json_schema', default_prompt_preset: 'test_preset', default_decoder: 'default_json_schema' },
    override: null,
    output: { mode: 'json_schema' as const },
    prompt: { preset: 'test_preset', system_append: 'system append text', developer_append: 'developer append text', user_prefix: 'user prefix text' },
    parse: { decoder: 'default_json_schema' },
    route: {}
  };

  it('groups system_core and system_policy into one system message with correct ordering', () => {
    const v2 = createV2Bundle({
      system_core: 'Core system instruction content.',
      system_policy: 'Policy content regarding access control.'
    });
    const messages = adaptPromptTreeToAiMessages(v2, TEST_TASK_CONFIG);
    const systemMessage = messages.find(m => m.role === 'system');
    expect(systemMessage).toBeDefined();
    expect(systemMessage!.parts[0].type).toBe('text');
    const text = (systemMessage!.parts[0] as { text: string }).text;
    // system_core (p=100) should appear before system_policy (p=95)
    const coreIndex = text.indexOf('Core system instruction');
    const policyIndex = text.indexOf('Policy content');
    expect(coreIndex).toBeLessThan(policyIndex);
    expect(text).toContain('system append text');
    expect(text).toContain('## System Prompt');
    expect(text).toContain('## System Policy Prompt');
  });

  it('produces a single developer message for role_core', () => {
    const v2 = createV2Bundle({
      role_core: 'Role: Agent X, Type: active'
    });
    const messages = adaptPromptTreeToAiMessages(v2, TEST_TASK_CONFIG);
    const devMessage = messages.find(m => m.role === 'developer');
    expect(devMessage).toBeDefined();
    const text = (devMessage!.parts[0] as { text: string }).text;
    expect(text).toContain('Role: Agent X');
    expect(text).toContain('developer append text');
  });

  it('groups user slots with correct priority ordering: post_process (60) before output_contract (50)', () => {
    const v2 = createV2Bundle({
      post_process: '{ "snapshot": true }',
      output_contract: 'Return JSON decision.'
    });
    const messages = adaptPromptTreeToAiMessages(v2, TEST_TASK_CONFIG);
    const userMessage = messages.find(m => m.role === 'user');
    expect(userMessage).toBeDefined();
    const text = (userMessage!.parts[0] as { text: string }).text;
    // post_process (p=60) before output_contract (p=50)
    const postIndex = text.indexOf('snapshot');
    const contractIndex = text.indexOf('Return JSON');
    expect(postIndex).toBeLessThan(contractIndex);
    expect(text).toContain('user prefix text');
  });

  it('suppresses combined_heading when combined_heading is null', () => {
    const v2 = createV2Bundle({
      post_process: 'No heading slot.'
    });
    const messages = adaptPromptTreeToAiMessages(v2, TEST_TASK_CONFIG);
    const userMessage = messages.find(m => m.role === 'user');
    expect(userMessage).toBeDefined();
    const text = (userMessage!.parts[0] as { text: string }).text;
    expect(text).not.toContain('## Post Process');
    expect(text).toContain('No heading slot.');
  });

  it('carries workflow metadata in each message', () => {
    const v2 = createV2Bundle({
      system_core: 'System test.',
      role_core: 'Role test.'
    });
    const messages = adaptPromptTreeToAiMessages(v2, TEST_TASK_CONFIG);
    for (const msg of messages) {
      expect(msg.metadata).toBeDefined();
      expect(msg.metadata!.workflow_profile_id).toBe('agent-decision-default');
      expect(msg.metadata!.workflow_step_keys).toEqual(['memory_projection', 'placement_resolution']);
    }
  });

  it('skips empty slots and produces no empty message', () => {
    const v2 = createV2Bundle({
      system_core: 'System test.',
      output_contract: ''
    });
    const messages = adaptPromptTreeToAiMessages(v2, TEST_TASK_CONFIG);
    const systemMsg = messages.find(m => m.role === 'system');
    expect(systemMsg).toBeDefined();
    // user message should still exist (user_prefix), 
    // but empty output_contract slot should not produce content
    const userMsg = messages.find(m => m.role === 'user');
    expect(userMsg).toBeDefined();
    const userText = (userMsg!.parts[0] as { text: string }).text;
    expect(userText).not.toContain('Output Contract');
  });
});
