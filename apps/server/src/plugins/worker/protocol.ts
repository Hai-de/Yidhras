import type { PluginInstallation, PluginManifest } from '@yidhras/contracts';
import { z } from 'zod';

import { contributionDescriptorListSchema } from './contribution_descriptors.js';

const nonEmptyStringSchema = z.string().trim().min(1);

export const serializedPluginErrorSchema = z.object({
  name: z.string().optional(),
  message: nonEmptyStringSchema,
  stack: z.string().optional(),
  code: z.string().optional(),
  source_location: z.object({
    file: z.string(),
    line: z.number().int().optional(),
    column: z.number().int().optional()
  }).optional(),
  cause: z.lazy(() => z.object({
    name: z.string().optional(),
    message: z.string(),
    stack: z.string().optional(),
    code: z.string().optional(),
    source_location: z.object({
      file: z.string(),
      line: z.number().int().optional(),
      column: z.number().int().optional()
    }).optional(),
    truncated: z.boolean().optional()
  }).optional())
});

export type SerializedPluginError = z.infer<typeof serializedPluginErrorSchema>;

/**
 * 从 V8 stack trace 第一帧提取源文件位置。
 */
const parseStackFrame = (stack: string): { file: string; line?: number; column?: number } | undefined => {
  const lines = stack.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('at ')) continue;

     
    const match = trimmed.match(
      /at\s+(?:(?:async\s+)?(?:\S+)\s+\()?(?:file:\/\/)?([^(:]+?)(?::(\d+))?(?::(\d+))?\)?$/
    );
    if (match && match[1]) {
      const result: { file: string; line?: number; column?: number } = { file: match[1].trim() };
      if (match[2]) result.line = Number(match[2]);
      if (match[3]) result.column = Number(match[3]);
      return result;
    }
  }
  return undefined;
};

/**
 * 序列化错误为跨线程传输格式。
 * @param error 原始错误对象
 * @param depth 当前递归深度（内部使用），最大 3 层
 */
export const serializePluginError = (error: unknown, depth: number = 0): SerializedPluginError => {
  if (error instanceof Error) {
    const withCode = error as Error & { code?: unknown };
    const result: SerializedPluginError = {
      name: error.name,
      message: error.message,
      stack: error.stack,
      code: typeof withCode.code === 'string' ? withCode.code : undefined,
      source_location: error.stack ? parseStackFrame(error.stack) : undefined
    };

    // 递归序列化 cause 链，最多 3 层
    if (error.cause && depth < 3) {
      result.cause = serializePluginError(error.cause, depth + 1);
    } else if (error.cause && depth >= 3) {
      result.cause = {
        // eslint-disable-next-line @typescript-eslint/no-base-to-string -- intentional truncation of cause chain at max depth
        message: String(error.cause),
        truncated: true
      };
    }

    return result;
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
  loadedServer: z.boolean(),
  handlerNames: z.array(z.string())
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
