import { execFile } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

import type { DataCleaner } from '@yidhras/contracts';
import { beforeAll, describe, expect, it } from 'vitest';

import type { SlotConditionEvaluator } from '../../src/plugins/extensions/slot_condition_registry.js';
import type { DataCleanerDescriptorInput, SlotConditionEvaluatorDescriptorInput } from '../../src/plugins/worker/contribution_descriptors.js';
import type { ServerPluginHostApi } from '../../src/plugins/runtime.js';

const execFileAsync = promisify(execFile);

const pluginIds = [
  'string-methods',
  'regex-engine',
  'template-engine',
  'slot-condition-builtin'
] as const;

function createHost() {
  const dataCleaners = new Map<string, DataCleaner>();
  const slotConditionEvaluators = new Map<string, SlotConditionEvaluator>();
  const handlers = new Map<string, (input: unknown) => unknown | Promise<unknown>>();

  const requireHandler = (invoke: string) => {
    const handler = handlers.get(invoke);
    if (!handler) {
      throw new Error(`handler not registered: ${invoke}`);
    }
    return handler;
  };

  const host: ServerPluginHostApi = {
    registerHandler(name, handler) {
      handlers.set(name, handler);
    },
    registerContextSource() {},
    registerPromptWorkflowStep() {},
    registerPackRoute() {},
    registerStepContributor() {},
    registerRuleContributor() {},
    registerQueryContributor() {},
    registerDataCleaner(descriptor: DataCleanerDescriptorInput) {
      dataCleaners.set(descriptor.key, {
        key: descriptor.key,
        version: descriptor.version,
        async clean(input) {
          return await requireHandler(descriptor.invoke)(input) as Awaited<ReturnType<DataCleaner['clean']>>;
        }
      });
    },
    registerSlotConditionEvaluator(descriptor: SlotConditionEvaluatorDescriptorInput) {
      slotConditionEvaluators.set(descriptor.key, {
        key: descriptor.key,
        version: descriptor.version,
        async evaluate(input) {
          return await requireHandler(descriptor.invoke)(input) as Awaited<ReturnType<SlotConditionEvaluator['evaluate']>>;
        }
      });
    },
    registerSlotContentTransformer() {},
    registerPerceptionResolver() {},
    async requestInference() {
      throw new Error('requestInference is not used by builtin plugin smoke tests');
    }
  };

  return { host, dataCleaners, slotConditionEvaluators };
}

describe('builtin system pack plugin bundles', () => {
  beforeAll(async () => {
    await execFileAsync('node', ['builtin/system_pack/plugins/build.mjs'], { cwd: process.cwd() });
  });

  it('imports dist/server.js bundles, activates plugins, registers contributions, and executes basic calls', async () => {
    const { host, dataCleaners, slotConditionEvaluators } = createHost();

    for (const pluginId of pluginIds) {
      const moduleUrl = pathToFileURL(`${process.cwd()}/builtin/system_pack/plugins/${pluginId}/dist/server.js`).href;
      const pluginModule = await import(moduleUrl) as { activate(host: ServerPluginHostApi): void };
      pluginModule.activate(host);
    }

    expect([...dataCleaners.keys()].sort()).toEqual([
      'data_cleaner.regex',
      'data_cleaner.string',
      'data_cleaner.template'
    ]);

    expect([...slotConditionEvaluators.keys()].sort()).toEqual([
      'slot_condition.context_length',
      'slot_condition.conversation_turn',
      'slot_condition.keyword_match',
      'slot_condition.logic_match'
    ]);

    await expect(
      dataCleaners.get('data_cleaner.string')?.clean({ text: '  Hello  ', options: { mode: 'trim' } })
    ).resolves.toMatchObject({ cleaned: 'Hello' });

    await expect(
      dataCleaners.get('data_cleaner.regex')?.clean({ text: 'abc123', options: { pattern: '\\d+', replacement: 'X' } })
    ).resolves.toMatchObject({ cleaned: 'abcX' });

    await expect(
      dataCleaners.get('data_cleaner.template')?.clean({ text: 'Hello {name}', options: { variables: { name: 'Ada' } } })
    ).resolves.toMatchObject({ cleaned: 'Hello Ada' });

    const baseContext = {
      slot_id: 'slot-1',
      variables: {},
      conversation_meta: { turn_count: 3 },
      token_budget: { total: 100, used: 40, remaining: 60 },
      current_tick: 1,
      last_user_message: 'hello world'
    };

    await expect(
      slotConditionEvaluators.get('slot_condition.keyword_match')?.evaluate({
        ...baseContext,
        options: { keywords: ['hello'], match_mode: 'any' }
      })
    ).resolves.toMatchObject({ active: true });

    await expect(
      slotConditionEvaluators.get('slot_condition.context_length')?.evaluate({
        ...baseContext,
        options: { operator: 'gt', value: 10 }
      })
    ).resolves.toMatchObject({ active: true });
  });
});
