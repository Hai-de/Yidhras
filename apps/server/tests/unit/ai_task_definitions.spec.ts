import { describe, expect, it } from 'vitest';

import type { AiPackConfig, AiTaskOverride } from '../../src/ai/types.js';
import { resolveAiTaskConfig } from '../../src/ai/task_definitions.js';

describe('resolveAiTaskConfig - tools chain', () => {
  it('returns empty tools and disabled tool_policy by default', () => {
    const config = resolveAiTaskConfig({ taskType: 'agent_decision' });

    expect(config.tools).toEqual([]);
    expect(config.tool_policy).toEqual({ mode: 'disabled' });
  });

  it('uses default_tools from definition when no overrides', () => {
    const config = resolveAiTaskConfig({
      taskType: 'agent_decision',
      inlineOverride: {
        tools: ['sys.get_clock_state', 'sys.get_entity']
      }
    });

    expect(config.tools).toEqual(['sys.get_clock_state', 'sys.get_entity']);
  });

  it('uses default_tool_policy from definition when no overrides', () => {
    const config = resolveAiTaskConfig({
      taskType: 'agent_decision',
      inlineOverride: {
        tool_policy: { mode: 'allowed', max_tool_calls: 3 }
      }
    });

    expect(config.tool_policy).toEqual({ mode: 'allowed', max_tool_calls: 3 });
  });

  it('pack task override takes precedence over definition defaults', () => {
    const packAiConfig: AiPackConfig = {
      tasks: {
        agent_decision: {
          tools: ['sys.get_clock_state'],
          tool_policy: { mode: 'required' }
        }
      }
    };

    const config = resolveAiTaskConfig({
      taskType: 'agent_decision',
      packAiConfig
    });

    expect(config.tools).toEqual(['sys.get_clock_state']);
    expect(config.tool_policy).toEqual({ mode: 'required' });
  });

  it('inline override takes precedence over pack override', () => {
    const packAiConfig: AiPackConfig = {
      tasks: {
        agent_decision: {
          tools: ['sys.get_clock_state'],
          tool_policy: { mode: 'allowed' }
        }
      }
    };

    const inlineOverride: AiTaskOverride = {
      tools: ['sys.get_entity', 'sys.get_relationship'],
      tool_policy: { mode: 'required' }
    };

    const config = resolveAiTaskConfig({
      taskType: 'agent_decision',
      packAiConfig,
      inlineOverride
    });

    expect(config.tools).toEqual(['sys.get_entity', 'sys.get_relationship']);
    expect(config.tool_policy).toEqual({ mode: 'required' });
  });

  it('tools and tool_policy merge independently with partial overrides', () => {
    const packAiConfig: AiPackConfig = {
      tasks: {
        agent_decision: {
          tools: ['sys.get_clock_state'],
          tool_policy: { mode: 'allowed', max_tool_calls: 5 }
        }
      }
    };

    const inlineOverride: AiTaskOverride = {
      tools: ['sys.get_entity']
    };

    const config = resolveAiTaskConfig({
      taskType: 'agent_decision',
      packAiConfig,
      inlineOverride
    });

    expect(config.tools).toEqual(['sys.get_entity']);
    expect(config.tool_policy).toEqual({ mode: 'allowed', max_tool_calls: 5 });
  });

  it('context_summary returns empty tools by default', () => {
    const config = resolveAiTaskConfig({ taskType: 'context_summary' });

    expect(config.tools).toEqual([]);
    expect(config.tool_policy).toEqual({ mode: 'disabled' });
  });

  it('does not merge tools when neither definition nor overrides set them', () => {
    const config = resolveAiTaskConfig({ taskType: 'moderation' });

    expect(config.tools).toEqual([]);
    expect(config.tool_policy).toEqual({ mode: 'disabled' });
  });
});
