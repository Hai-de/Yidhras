import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createXiaomiMiMoProviderAdapter } from '../../../src/ai/providers/xiaomi_mimo.js';
import type { AiMessage } from '../../src/ai/types.js';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const envPath = join(__dirname, '..', '..', '..', '..', '.env');
if (existsSync(envPath)) {
  process.loadEnvFile(envPath);
}

const API_KEY_ENV = process.env.TEST_MIMO_API_KEY;

if (!API_KEY_ENV) {
  console.error('未设置 API key。请 export TEST_MIMO_API_KEY="sk-..." 或 export MIMO_API_KEY="sk-..."');
  process.exit(1);
}

console.log('API key 已检测到:', API_KEY_ENV.slice(0, 12) + '...');

const adapter = createXiaomiMiMoProviderAdapter();

const msg: AiMessage = {
  role: 'user',
  parts: [{ type: 'text', text: '你是🐷吗？' }],
};

const request = {
  request: {
    invocation_id: 'inv-live-test',
    task_id: 'task-live-test',
    task_type: 'agent_decision' as const,
    provider_hint: null,
    model_hint: null,
    route_id: null,
    messages: [msg],
    response_mode: 'free_text' as const,
    structured_output: null,
    tools: [],
    tool_policy: { mode: 'disabled' as const },
    execution: { timeout_ms: 30000, retry_limit: 0, allow_fallback: true, idempotency_key: null },
    governance: { privacy_tier: 'trusted_cloud' as const, audit_level: 'standard' as const, safety_profile: null },
    metadata: {
      prompt_preset: 'default',
      decoder: 'auto',
      workflow_task_type: 'agent_decision',
      task_metadata: null,
      task_input: {},
      inference_id: null,
      workflow_profile_id: null,
      workflow_profile_version: null,
      workflow_step_keys: [],
      processing_trace: null,
    },
  },
  task_request: {
    task_id: 'task-live-test',
    task_type: 'agent_decision',
    pack_id: 'test-pack',
    actor_ref: { identity_id: 'agent-001', identity_type: 'agent', role: 'active', agent_id: 'agent-001', atmosphere_node_id: null },
    input: { actor_display_name: 'Test', world_name: 'Test World' },
    prompt_context: { prompt_bundle_v2: null },
    output_contract: undefined,
    route_hints: {},
    metadata: { prompt_version: '1.0.0', source_prompt_keys: [] },
  },
  task_config: {
    tools: [],
    tool_policy: { mode: 'disabled' as const },
    route: { privacy_tier: 'trusted_cloud' as const },
    prompt: { preset: 'default' },
    output: { mode: 'free_text' as const, strict: false },
    parse: { decoder: 'auto', unwrap: undefined, field_alias: undefined, defaults: undefined, required_fields: [] },
    override: null,
    metadata: undefined,
    definition: {
      task_type: 'agent_decision',
      default_response_mode: 'free_text' as const,
      default_prompt_preset: 'default',
      default_decoder: 'auto',
    },
  },
  model_entry: {
    provider: 'mimo',
    model: 'mimo-v2.5-pro',
    endpoint_kind: 'chat_completions' as const,
    capabilities: {
      text_generation: true,
      structured_output: 'json_object' as const,
      tool_calling: true,
      vision_input: false,
      embeddings: false,
      rerank: false,
    },
    tags: [],
    availability: 'active' as const,
  },
  provider_config: {
    provider: 'mimo',
    api_key_env: process.env.TEST_MIMO_API_KEY ? 'TEST_MIMO_API_KEY' : 'MIMO_API_KEY',
    base_url: 'https://token-plan-sgp.xiaomimimo.com/v1',
    enabled: true,
  },
};

async function main() {
  console.log('\n--- 正在调用 MiMo API (mimo-v2.5-pro) ---');
  console.log('问题: 你是🐷吗？\n');

  const start = Date.now();
  const result = await adapter.execute(request);
  const elapsed = Date.now() - start;

  console.log(`=== 响应 (${elapsed}ms) ===`);
  console.log('status:', result.status);
  console.log('finish_reason:', result.finish_reason);
  console.log('output.text:', result.output.text);
  console.log('output.mode:', result.output.mode);
  if (result.usage) {
    console.log('usage:', JSON.stringify(result.usage));
  }
  if (result.error) {
    console.log('error:', JSON.stringify(result.error, null, 2));
  }
  if (result.raw_ref) {
    console.log('raw_ref:', JSON.stringify(result.raw_ref));
  }
}

main().catch((err) => {
  console.error('调用失败:', err);
  process.exit(1);
});
