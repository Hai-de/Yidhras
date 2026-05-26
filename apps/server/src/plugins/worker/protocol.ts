import type { PluginInstallation, PluginManifest } from '@yidhras/contracts';
import { z } from 'zod';

import { contributionDescriptorListSchema } from './contribution_descriptors.js';

const nonEmptyStringSchema = z.string().trim().min(1);

export const serializedPluginErrorSchema = z.object({
  name: z.string().optional(),
  message: nonEmptyStringSchema,
  stack: z.string().optional(),
  code: z.string().optional()
});

export type SerializedPluginError = z.infer<typeof serializedPluginErrorSchema>;

export const serializePluginError = (error: unknown): SerializedPluginError => {
  if (error instanceof Error) {
    const withCode = error as Error & { code?: unknown };
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
      code: typeof withCode.code === 'string' ? withCode.code : undefined
    };
  }

  return { message: String(error) };
};

const requestIdSchema = nonEmptyStringSchema;

export const pluginWorkerActivationInputSchema = z.object({
  hostApiVersion: nonEmptyStringSchema,
  manifest: z.custom<PluginManifest>(value => typeof value === 'object' && value !== null),
  installation: z.custom<PluginInstallation>(value => typeof value === 'object' && value !== null),
  artifactRoot: nonEmptyStringSchema,
  entrypointPath: nonEmptyStringSchema,
  packId: nonEmptyStringSchema,
  grantedCapabilities: z.array(nonEmptyStringSchema)
});

export const pluginWorkerActivationResultSchema = z.object({
  descriptors: contributionDescriptorListSchema,
  loadedServer: z.boolean()
});

export const pluginWorkerInvokeInputSchema = z.object({
  contributionType: nonEmptyStringSchema,
  invoke: nonEmptyStringSchema,
  payload: z.unknown()
});

export const pluginWorkerInvokeResultSchema = z.object({
  result: z.unknown()
});

export const hostMethodNameSchema = z.enum([
  'requestInference',
  'getPackSummary',
  'getCurrentTick',
  'queryWorldState',
  'emitLog',
  'upsertPackCollectionRecord',
  'listPackCollectionRecords',
  'emitPackEvent'
]);

export type HostMethodName = z.infer<typeof hostMethodNameSchema>;

export const mainToWorkerMessageSchema = z.union([
  z.object({
    type: z.literal('activate'),
    requestId: requestIdSchema,
    input: pluginWorkerActivationInputSchema
  }),
  z.object({
    type: z.literal('invoke'),
    requestId: requestIdSchema,
    input: pluginWorkerInvokeInputSchema
  }),
  z.object({
    type: z.literal('host_result'),
    requestId: requestIdSchema,
    ok: z.literal(true),
    result: z.unknown()
  }),
  z.object({
    type: z.literal('host_result'),
    requestId: requestIdSchema,
    ok: z.literal(false),
    error: serializedPluginErrorSchema
  }),
  z.object({
    type: z.literal('deactivate'),
    requestId: requestIdSchema
  })
]);

export const workerToMainMessageSchema = z.union([
  z.object({
    type: z.literal('activation_result'),
    requestId: requestIdSchema,
    ok: z.literal(true),
    result: pluginWorkerActivationResultSchema
  }),
  z.object({
    type: z.literal('activation_result'),
    requestId: requestIdSchema,
    ok: z.literal(false),
    error: serializedPluginErrorSchema
  }),
  z.object({
    type: z.literal('invoke_result'),
    requestId: requestIdSchema,
    ok: z.literal(true),
    result: z.unknown()
  }),
  z.object({
    type: z.literal('invoke_result'),
    requestId: requestIdSchema,
    ok: z.literal(false),
    error: serializedPluginErrorSchema
  }),
  z.object({
    type: z.literal('host_call'),
    requestId: requestIdSchema,
    method: hostMethodNameSchema,
    payload: z.unknown()
  }),
  z.object({
    type: z.literal('deactivate_result'),
    requestId: requestIdSchema,
    ok: z.literal(true)
  }),
  z.object({
    type: z.literal('deactivate_result'),
    requestId: requestIdSchema,
    ok: z.literal(false),
    error: serializedPluginErrorSchema
  }),
  z.object({
    type: z.literal('log'),
    level: z.enum(['debug', 'info', 'warn', 'error']),
    message: nonEmptyStringSchema,
    fields: z.record(z.string(), z.unknown()).optional()
  })
]);

export type PluginWorkerActivationInput = z.infer<typeof pluginWorkerActivationInputSchema>;
export type PluginWorkerActivationResult = z.infer<typeof pluginWorkerActivationResultSchema>;
export type PluginWorkerInvokeInput = z.infer<typeof pluginWorkerInvokeInputSchema>;
export type PluginWorkerInvokeResult = z.infer<typeof pluginWorkerInvokeResultSchema>;
export type MainToWorkerMessage = z.infer<typeof mainToWorkerMessageSchema>;
export type WorkerToMainMessage = z.infer<typeof workerToMainMessageSchema>;

export const parseMainToWorkerMessage = (value: unknown): MainToWorkerMessage => {
  return mainToWorkerMessageSchema.parse(value);
};

export const parseWorkerToMainMessage = (value: unknown): WorkerToMainMessage => {
  return workerToMainMessageSchema.parse(value);
};
