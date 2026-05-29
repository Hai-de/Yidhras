import { describe, expect, it } from 'vitest';

import { buildPromptBundleFromAiMessages } from '../../../src/ai/prompt_bundle_from_messages.js';
import type { AiMessage } from '../../../src/ai/types.js';

describe('prompt_bundle_from_messages', () => {
  describe('buildPromptBundleFromAiMessages', () => {
    it('returns bundle with expected shape', () => {
      const messages: AiMessage[] = [
        { role: 'system', parts: [{ type: 'text', text: 'You are a helpful assistant' }] },
        { role: 'user', parts: [{ type: 'text', text: 'Hello' }] }
      ];
      const bundle = buildPromptBundleFromAiMessages({
        taskId: 'task-1',
        taskType: 'agent_decision',
        messages
      });
      
      expect(bundle).toBeDefined();
      expect(bundle.slots).toBeDefined();
      expect(bundle.slot_order).toBeDefined();
      expect(bundle.combined_prompt).toBeDefined();
      expect(bundle.metadata).toBeDefined();
      expect(bundle.tree).toBeDefined();
    });

    it('maps system message to system_core slot', () => {
      const messages: AiMessage[] = [
        { role: 'system', parts: [{ type: 'text', text: 'System prompt' }] }
      ];
      const bundle = buildPromptBundleFromAiMessages({
        taskId: 'task-1',
        taskType: 'agent_decision',
        messages
      });
      
      expect(bundle.tree.slot_registry['system_core']).toBeDefined();
      expect(bundle.tree.slot_registry['system_core'].message_role).toBe('system');
    });

    it('maps developer message to role_core slot', () => {
      const messages: AiMessage[] = [
        { role: 'developer', parts: [{ type: 'text', text: 'Developer instruction' }] }
      ];
      const bundle = buildPromptBundleFromAiMessages({
        taskId: 'task-1',
        taskType: 'agent_decision',
        messages
      });
      
      expect(bundle.tree.slot_registry['role_core']).toBeDefined();
      expect(bundle.tree.slot_registry['role_core'].message_role).toBe('developer');
    });

    it('maps user message to output_contract slot', () => {
      const messages: AiMessage[] = [
        { role: 'user', parts: [{ type: 'text', text: 'User message' }] }
      ];
      const bundle = buildPromptBundleFromAiMessages({
        taskId: 'task-1',
        taskType: 'agent_decision',
        messages
      });
      
      expect(bundle.tree.slot_registry['output_contract']).toBeDefined();
      expect(bundle.tree.slot_registry['output_contract'].message_role).toBe('user');
    });

    it('maps assistant message to output_contract slot', () => {
      const messages: AiMessage[] = [
        { role: 'assistant', parts: [{ type: 'text', text: 'Assistant response' }] }
      ];
      const bundle = buildPromptBundleFromAiMessages({
        taskId: 'task-1',
        taskType: 'agent_decision',
        messages
      });
      
      expect(bundle.tree.slot_registry['output_contract']).toBeDefined();
    });

    it('maps tool message to output_contract slot', () => {
      const messages: AiMessage[] = [
        { role: 'tool', parts: [{ type: 'text', text: 'Tool result' }] }
      ];
      const bundle = buildPromptBundleFromAiMessages({
        taskId: 'task-1',
        taskType: 'agent_decision',
        messages
      });
      
      expect(bundle.tree.slot_registry['output_contract']).toBeDefined();
    });

    it('builds combined_prompt from message text', () => {
      const messages: AiMessage[] = [
        { role: 'system', parts: [{ type: 'text', text: 'System prompt' }] },
        { role: 'user', parts: [{ type: 'text', text: 'User message' }] }
      ];
      const bundle = buildPromptBundleFromAiMessages({
        taskId: 'task-1',
        taskType: 'agent_decision',
        messages
      });
      
      expect(bundle.combined_prompt).toContain('System prompt');
      expect(bundle.combined_prompt).toContain('User message');
    });

    it('handles multiple parts in a message', () => {
      const messages: AiMessage[] = [
        { 
          role: 'user', 
          parts: [
            { type: 'text', text: 'Part 1' },
            { type: 'text', text: 'Part 2' }
          ] 
        }
      ];
      const bundle = buildPromptBundleFromAiMessages({
        taskId: 'task-1',
        taskType: 'agent_decision',
        messages
      });
      
      expect(bundle.combined_prompt).toContain('Part 1');
      expect(bundle.combined_prompt).toContain('Part 2');
    });

    it('handles json part type', () => {
      const messages: AiMessage[] = [
        { role: 'user', parts: [{ type: 'json', json: { key: 'value' } }] }
      ];
      const bundle = buildPromptBundleFromAiMessages({
        taskId: 'task-1',
        taskType: 'agent_decision',
        messages
      });
      
      expect(bundle.combined_prompt).toContain('"key":"value"');
    });

    it('handles image_url part type', () => {
      const messages: AiMessage[] = [
        { role: 'user', parts: [{ type: 'image_url', url: 'https://example.com/img.png' }] }
      ];
      const bundle = buildPromptBundleFromAiMessages({
        taskId: 'task-1',
        taskType: 'agent_decision',
        messages
      });
      
      expect(bundle.combined_prompt).toContain('[image_url:https://example.com/img.png]');
    });

    it('handles file_ref part type', () => {
      const messages: AiMessage[] = [
        { role: 'user', parts: [{ type: 'file_ref', file_id: 'file-123' }] }
      ];
      const bundle = buildPromptBundleFromAiMessages({
        taskId: 'task-1',
        taskType: 'agent_decision',
        messages
      });
      
      expect(bundle.combined_prompt).toContain('[file_ref:file-123]');
    });

    it('handles file_ref with mime_type', () => {
      const messages: AiMessage[] = [
        { role: 'user', parts: [{ type: 'file_ref', file_id: 'file-123', mime_type: 'application/pdf' }] }
      ];
      const bundle = buildPromptBundleFromAiMessages({
        taskId: 'task-1',
        taskType: 'agent_decision',
        messages
      });
      
      expect(bundle.combined_prompt).toContain('[file_ref:file-123:application/pdf]');
    });

    it('sets task metadata correctly', () => {
      const messages: AiMessage[] = [
        { role: 'user', parts: [{ type: 'text', text: 'Test' }] }
      ];
      const bundle = buildPromptBundleFromAiMessages({
        taskId: 'task-123',
        taskType: 'workflow_step',
        messages,
        promptVersion: 'v2',
        sourcePromptKeys: ['key1', 'key2']
      });
      
      expect(bundle.metadata.prompt_version).toBe('v2');
      expect(bundle.metadata.source_prompt_keys).toEqual(['key1', 'key2']);
      expect(bundle.metadata.workflow_task_type).toBe('workflow_step');
    });

    it('uses default prompt version when not provided', () => {
      const messages: AiMessage[] = [
        { role: 'user', parts: [{ type: 'text', text: 'Test' }] }
      ];
      const bundle = buildPromptBundleFromAiMessages({
        taskId: 'task-1',
        taskType: 'agent_decision',
        messages
      });
      
      expect(bundle.metadata.prompt_version).toBe('direct-bundle-v1');
    });

    it('creates tree with correct inference_id and task_type', () => {
      const messages: AiMessage[] = [
        { role: 'user', parts: [{ type: 'text', text: 'Test' }] }
      ];
      const bundle = buildPromptBundleFromAiMessages({
        taskId: 'task-999',
        taskType: 'custom_type',
        messages
      });
      
      expect(bundle.tree.inference_id).toBe('task-999');
      expect(bundle.tree.task_type).toBe('custom_type');
    });

    it('handles empty messages', () => {
      const bundle = buildPromptBundleFromAiMessages({
        taskId: 'task-1',
        taskType: 'agent_decision',
        messages: []
      });
      
      expect(bundle.slots).toEqual({});
      expect(bundle.slot_order).toEqual([]);
      expect(bundle.combined_prompt).toBe('');
    });

    it('skips empty text from combined_prompt', () => {
      const messages: AiMessage[] = [
        { role: 'user', parts: [{ type: 'text', text: '' }] },
        { role: 'system', parts: [{ type: 'text', text: 'Valid text' }] }
      ];
      const bundle = buildPromptBundleFromAiMessages({
        taskId: 'task-1',
        taskType: 'agent_decision',
        messages
      });
      
      // Empty text should not be included
      expect(bundle.combined_prompt).not.toContain('\n\n');
      expect(bundle.combined_prompt.trim()).toBe('Valid text');
    });

    it('handles multiple messages in same slot', () => {
      const messages: AiMessage[] = [
        { role: 'user', parts: [{ type: 'text', text: 'First user message' }] },
        { role: 'user', parts: [{ type: 'text', text: 'Second user message' }] }
      ];
      const bundle = buildPromptBundleFromAiMessages({
        taskId: 'task-1',
        taskType: 'agent_decision',
        messages
      });
      
      // Both should be in output_contract slot
      expect(bundle.tree.fragments_by_slot['output_contract']).toHaveLength(2);
      expect(bundle.slots['output_contract']).toContain('First user message');
      expect(bundle.slots['output_contract']).toContain('Second user message');
    });
  });
});
