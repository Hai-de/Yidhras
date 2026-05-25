import type { PluginInferenceRequest, PluginInferenceResult, ServerPluginHostApi } from '../runtime.js';
import {
  contributionDescriptorListSchema,
  contributionDescriptorSchema,
  type ContributionDescriptor,
  type ContributionDescriptorInput
} from './contribution_descriptors.js';
import type { HostMethodName, WorkerToMainMessage } from './protocol.js';

export type PluginInvokeHandler = (input: unknown) => unknown | Promise<unknown>;

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
      return result as PluginInferenceResult;
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
