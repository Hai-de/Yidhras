import 'dotenv/config';

import { existsSync,readFileSync  } from 'node:fs';
import path from 'node:path';

import * as YAML from 'yaml';

import { BUILTIN_AI_REGISTRY_CONFIG } from '../ai/registry.js';
import type { AiModelRegistryEntry, AiProviderConfig } from '../ai/types.js';
import { resolveWorkspaceRoot } from '../config/loader.js';

const workspaceRoot = resolveWorkspaceRoot();
const serverDir = path.join(workspaceRoot, 'apps', 'server');

interface AiModelsFile {
  version?: number;
  providers?: AiProviderConfig[];
  models?: AiModelRegistryEntry[];
  routes?: unknown[];
}

const COMMANDS = ['models', 'test'] as const;

interface ParsedArgs {
  command?: string;
  modelId?: string;
  help?: boolean;
  json?: boolean;
}

const parseArgs = (argv: string[]): ParsedArgs => {
  const parsed: ParsedArgs = {};

  for (const arg of argv) {
    switch (arg) {
      case '--help':
      case '-h':
        parsed.help = true;
        break;
      case '--json':
        parsed.json = true;
        break;
      default:
        if (COMMANDS.includes(arg as (typeof COMMANDS)[number])) {
          parsed.command = arg;
        } else if (!arg.startsWith('-') && parsed.command === 'test' && !parsed.modelId) {
          parsed.modelId = arg;
        }
    }
  }

  return parsed;
};

const printHelp = (): void => {
  console.log(`ai — AI 网关工具

用法:
  pnpm ai models                  列出所有注册模型及状态
  pnpm ai test <model-id>         发送最小化请求验证连通性
  pnpm ai --help                  显示此帮助
`);
};

const loadMergedConfig = (): { models: AiModelRegistryEntry[]; providers: AiProviderConfig[] } => {
  const builtinModels = BUILTIN_AI_REGISTRY_CONFIG.models ?? [];
  const builtinProviders = BUILTIN_AI_REGISTRY_CONFIG.providers ?? [];

  const configPath = path.join(serverDir, 'config', 'ai_models.yaml');
  if (existsSync(configPath)) {
    const fileOverride = YAML.parse(readFileSync(configPath, 'utf-8')) as AiModelsFile;
    const overrideModels = fileOverride.models ?? [];
    const overrideProviders = fileOverride.providers ?? [];

    const mergedProviders = [...builtinProviders];
    for (const op of overrideProviders) {
      const idx = mergedProviders.findIndex((bp) => bp.provider === op.provider);
      if (idx >= 0) {
        mergedProviders[idx] = { ...mergedProviders[idx], ...op };
      } else {
        mergedProviders.push(op);
      }
    }

    const mergedModels = [...builtinModels];
    for (const om of overrideModels) {
      const idx = mergedModels.findIndex((bm) => bm.provider === om.provider && bm.model === om.model);
      if (idx >= 0) {
        mergedModels[idx] = { ...mergedModels[idx], ...om };
      } else {
        mergedModels.push(om);
      }
    }

    return { models: mergedModels, providers: mergedProviders };
  }

  return { models: builtinModels, providers: builtinProviders };
};

const doModels = (args: ParsedArgs): void => {
  const config = loadMergedConfig();
  const models = config.models;

  if (models.length === 0) {
    console.log('没有找到注册的模型');
    return;
  }

  if (args.json) {
    console.log(JSON.stringify(models, null, 2));
    return;
  }

  const pWidth = Math.max(...models.map((m) => m.provider.length), 8);
  const mWidth = Math.max(...models.map((m) => m.model.length), 5);
  const eWidth = Math.max(...models.map((m) => m.endpoint_kind.length), 13);
  const aWidth = Math.max(...models.map((m) => m.availability.length), 12);

  console.log(
    `${'PROVIDER'.padEnd(pWidth)}  ${'MODEL'.padEnd(mWidth)}  ${'ENDPOINT'.padEnd(eWidth)}  ${'AVAILABILITY'.padEnd(aWidth)}  TAGS`
  );
  console.log(
    `${'-'.repeat(pWidth)}  ${'-'.repeat(mWidth)}  ${'-'.repeat(eWidth)}  ${'-'.repeat(aWidth)}  ----`
  );

  for (const m of models) {
    console.log(
      `${m.provider.padEnd(pWidth)}  ${m.model.padEnd(mWidth)}  ${m.endpoint_kind.padEnd(eWidth)}  ${m.availability.padEnd(aWidth)}  ${m.tags.join(', ') || '-'}`
    );
  }
};

const doTest = async (args: ParsedArgs): Promise<void> => {
  if (!args.modelId) {
    console.error('错误: 请指定模型 ID (pnpm ai test <model-id>)');
    process.exitCode = 1;
    return;
  }

  const config = loadMergedConfig();
  const model = config.models.find((m) => m.model === args.modelId);

  if (!model) {
    console.error(
      `错误: 未找到模型 "${args.modelId}"。使用 "pnpm ai models" 查看可用模型列表。`
    );
    process.exitCode = 1;
    return;
  }

  const providerConfig = config.providers.find((p) => p.provider === model.provider);
  const apiKeyEnv = providerConfig?.api_key_env;
  const baseUrl = providerConfig?.base_url ?? model.base_url;

  if (apiKeyEnv && !process.env[apiKeyEnv]) {
    console.error(`错误: 环境变量 ${apiKeyEnv} 未设置 (provider: ${model.provider})`);
    process.exitCode = 1;
    return;
  }

  console.log(`测试模型: ${model.provider}/${model.model}`);
  console.log(`端点类型: ${model.endpoint_kind}`);
  if (baseUrl) {
    console.log(`Base URL: ${baseUrl}`);
  }
  console.log('');

  const apiKey = apiKeyEnv ? process.env[apiKeyEnv]! : '';
  const endpoint = baseUrl ?? 'https://api.openai.com/v1';

  const requestBody = {
    model: model.model,
    messages: [{ role: 'user', content: 'Hello, respond with "ok" only.' }],
    max_tokens: 10
  };

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${apiKey}`
  };

  const endpointPath =
    model.endpoint_kind === 'chat_completions' ? '/chat/completions' : '/responses';

  const startTime = Date.now();
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);

    const res = await fetch(`${endpoint}${endpointPath}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(requestBody),
      signal: controller.signal
    });
    clearTimeout(timeout);

    const elapsed = Date.now() - startTime;
    const body = (await res.json()) as Record<string, unknown>;

    if (args.json) {
      console.log(JSON.stringify({ status: res.status, elapsed_ms: elapsed, body }, null, 2));
      return;
    }

    console.log(`状态: ${res.status} (${elapsed}ms)`);

    if (res.ok) {
      const choices = body.choices as Array<{ message?: { content?: string } }> | undefined;
      const content = choices?.[0]?.message?.content ?? JSON.stringify(body);
      console.log(`响应: ${content}`);
    } else {
      console.log(
        `错误: ${(body.error as Record<string, string>)?.message ?? JSON.stringify(body)}`
      );
    }
  } catch (error) {
    const elapsed = Date.now() - startTime;
    console.error(`请求失败 (${elapsed}ms): ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
};

const runCli = async (): Promise<void> => {
  const args = parseArgs(process.argv.slice(2));

  if (args.help || !args.command) {
    printHelp();
    process.exitCode = args.help ? 0 : 1;
    return;
  }

  try {
    switch (args.command) {
      case 'models':
        doModels(args);
        break;
      case 'test':
        await doTest(args);
        break;
      default:
        console.error(`错误: 未知命令 "${args.command}"。使用 --help 查看帮助。`);
        process.exitCode = 1;
    }
  } catch (error) {
    console.error('错误:', error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
};

void runCli();
