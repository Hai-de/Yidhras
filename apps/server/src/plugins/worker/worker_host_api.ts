import { z } from 'zod';

import type { PluginInferenceRequest, PluginInferenceResult, ServerPluginHostApi } from '../runtime.js';
import {
  type ContributionDescriptor,
  type ContributionDescriptorInput,
  contributionDescriptorListSchema,
  contributionDescriptorSchema} from './contribution_descriptors.js';
import type { HostMethodName, WorkerToMainMessage } from './protocol.js';

export type PluginInvokeHandler = (input: unknown) => unknown;

type HostCallSender = (method: HostMethodName, payload: unknown) => Promise<unknown>;
type MessageSender = (message: WorkerToMainMessage) => void;

const normalizeHandlerName = (name: string): string => {
  const normalized = name.trim();
  if (normalized.length === 0) {
    throw new Error('Plugin handler name must not be empty');
  }
  return normalized;
};

export interface WorkerPluginHostRuntime {
  readonly host: ServerPluginHostApi;
  readonly handlers: ReadonlyMap<string, PluginInvokeHandler>;
  getDescriptors(): ContributionDescriptor[];
}

export const createWorkerPluginHostApi = (options: {
  sendHostCall: HostCallSender;
  sendMessage: MessageSender;
}): WorkerPluginHostRuntime => {
  const handlers = new Map<string, PluginInvokeHandler>();
  const descriptors: ContributionDescriptor[] = [];

  const registerDescriptor = (descriptor: ContributionDescriptorInput): void => {
    const parsed = contributionDescriptorSchema.parse(descriptor);
    const duplicate = descriptors.find(existing => existing.type === parsed.type && existing.name === parsed.name);
    if (duplicate) {
      throw new Error(`Duplicate plugin contribution descriptor: ${parsed.type}:${parsed.name}`);
    }
    descriptors.push(parsed);
  };

  const host: ServerPluginHostApi = {
    registerHandler(name, handler) {
      const normalized = normalizeHandlerName(name);
      if (handlers.has(normalized)) {
        throw new Error(`Duplicate plugin handler: ${normalized}`);
      }
      handlers.set(normalized, handler);
    },

    registerContextSource(descriptor) {
      registerDescriptor({ ...descriptor, capabilityKey: descriptor.capabilityKey ?? 'server.context_source.register' });
    },

    registerPromptWorkflowStep(descriptor) {
      registerDescriptor({ ...descriptor, capabilityKey: descriptor.capabilityKey ?? 'server.prompt_workflow.register' });
    },

    registerPackRoute(descriptor) {
      registerDescriptor({ ...descriptor, capabilityKey: descriptor.capabilityKey ?? 'server.api_route.register' });
    },

    registerStepContributor(descriptor) {
      registerDescriptor({ ...descriptor, capabilityKey: descriptor.capabilityKey ?? 'server.step_contributor.register' });
    },

    registerRuleContributor(descriptor) {
      registerDescriptor({ ...descriptor, capabilityKey: descriptor.capabilityKey ?? 'server.rule_contributor.register' });
    },

    registerQueryContributor(descriptor) {
      registerDescriptor({ ...descriptor, capabilityKey: descriptor.capabilityKey ?? 'server.query_contributor.register' });
    },

    registerDataCleaner(descriptor) {
      registerDescriptor({ ...descriptor, capabilityKey: descriptor.capabilityKey ?? 'server.data_cleaner.register' });
    },

    registerSlotConditionEvaluator(descriptor) {
      registerDescriptor({ ...descriptor, capabilityKey: descriptor.capabilityKey ?? 'server.slot_condition.register' });
    },

    registerSlotContentTransformer(descriptor) {
      registerDescriptor({ ...descriptor, capabilityKey: descriptor.capabilityKey ?? 'server.slot_content_transform.register' });
    },

    registerPerceptionResolver(descriptor) {
      registerDescriptor({ ...descriptor, capabilityKey: descriptor.capabilityKey ?? 'server.perception_resolver.register' });
    },

    async requestInference(input: PluginInferenceRequest): Promise<PluginInferenceResult> {
      const result = await options.sendHostCall('requestInference', input);
      return z
        .object({
          content: z.string(),
          usage: z.object({
            inputTokens: z.number(),
            outputTokens: z.number()
          })
        })
        .parse(result);
    },

    async upsertPackCollectionRecord(collectionKey: string, record: Record<string, unknown>): Promise<void> {
      await options.sendHostCall('upsertPackCollectionRecord', { collectionKey, record });
    },

    async listPackCollectionRecords(collectionKey: string): Promise<Record<string, unknown>[]> {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- boundary type assertion
      return options.sendHostCall('listPackCollectionRecords', { collectionKey }) as Promise<Record<string, unknown>[]>;
    },

    async emitEvent(event: { title: string; description: string; type: string; impact_data?: Record<string, unknown>; location_id?: string; visibility?: string }): Promise<void> {
      await options.sendHostCall('emitPackEvent', event);
    },

    registerLoopHook(hookPoint: string, handler: (ctx: Record<string, unknown>) => Promise<void>): void {
      const handlerName = `__loop_hook:${hookPoint}`;
      registerDescriptor({
        type: 'loop_hook',
        name: handlerName,
        invoke: handlerName,
        hookPoint,
        priority: 0
      });
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- wrapper: loop hook handler matches invoke handler shape
      handlers.set(handlerName, handler as PluginInvokeHandler);
    }
  };

  return {
    host,
    handlers,
    getDescriptors() {
      return contributionDescriptorListSchema.parse(descriptors);
    }
  };
};
