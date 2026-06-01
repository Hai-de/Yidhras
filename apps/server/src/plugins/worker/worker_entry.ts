import { parentPort } from 'node:worker_threads';

import { relativizePath } from '../../utils/error_source.js';
import {
  type HostMethodName,
  type MainToWorkerMessage,
  parseMainToWorkerMessage,
  parseWorkerToMainMessage,
  type SerializedPluginError,
  serializePluginError,
  type WorkerToMainMessage
} from './protocol.js';
import { createWorkerPluginHostApi } from './worker_host_api.js';

if (!parentPort) {
  throw new Error('plugin worker_entry must run inside a Worker thread');
}
const port = parentPort;

type ActivateResult = void | (() => void | Promise<void>) | { deactivate?: () => void | Promise<void> };

const pendingHostCalls = new Map<string, { resolve(value: unknown): void; reject(error: Error): void }>();
let deactivateHook: (() => void | Promise<void>) | null = null;
let runtime: ReturnType<typeof createWorkerPluginHostApi> | null = null;
let hostCallSequence = 0;
let artifactRoot: string | null = null;

const postToMain = (message: WorkerToMainMessage): void => {
  port.postMessage(parseWorkerToMainMessage(message));
};

const deserializeError = (error: { name?: string; message: string; stack?: string; code?: string }): Error => {
  const next = new Error(error.message);
  next.name = error.name ?? 'PluginHostCallError';
// @ts-expect-error -- EOPT strict mode
  next.stack = error.stack;
  if (error.code) {
    (next as Error & { code?: string }).code = error.code;
  }
  return next;
};

/**
 * 将序列化错误的 source_location 转为相对路径（基于 artifactRoot）。
 * 原地修改并返回同一对象。
 */
const relativizeErrorLocation = (err: SerializedPluginError): SerializedPluginError => {
  if (err.source_location && artifactRoot) {
    err.source_location.file = relativizePath(err.source_location.file, artifactRoot);
  }
  if (err.cause && err.cause.source_location && artifactRoot) {
    err.cause.source_location.file = relativizePath(err.cause.source_location.file, artifactRoot);
  }
  return err;
};

const sendHostCall = (method: HostMethodName, payload: unknown): Promise<unknown> => {
  const requestId = `host:${Date.now()}:${++hostCallSequence}`;
  return new Promise((resolve, reject) => {
    pendingHostCalls.set(requestId, { resolve, reject });
    postToMain({ type: 'host_call', requestId, method, payload });
  });
};

const handleHostResult = (message: Extract<MainToWorkerMessage, { type: 'host_result' }>): void => {
  const pending = pendingHostCalls.get(message.requestId);
  if (!pending) {
    return;
  }
  pendingHostCalls.delete(message.requestId);
  if (message.ok) {
    pending.resolve(message.result);
    return;
  }
// @ts-expect-error -- EOPT strict mode
  pending.reject(deserializeError(message.error));
};

const resolveDeactivate = (result: ActivateResult): void => {
  if (typeof result === 'function') {
    deactivateHook = result;
    return;
  }
  if (result && typeof result.deactivate === 'function') {
    deactivateHook = result.deactivate;
  }
};

const handleActivate = async (message: Extract<MainToWorkerMessage, { type: 'activate' }>): Promise<void> => {
  try {
    artifactRoot = message.input.artifactRoot;
    runtime = createWorkerPluginHostApi({ sendHostCall, sendMessage: postToMain });
    const activatedRuntime = runtime;
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- boundary type assertion
    const module = await import(message.input.entrypointPath) as {
      activate?: (host: typeof activatedRuntime.host) => ActivateResult | Promise<ActivateResult>;
    };

    if (typeof module.activate === 'function') {
      const result = await module.activate(activatedRuntime.host);
      resolveDeactivate(result);
    }

    postToMain({
      type: 'activation_result',
      requestId: message.requestId,
      ok: true,
      result: {
        descriptors: activatedRuntime.getDescriptors(),
        loadedServer: typeof module.activate === 'function',
        handlerNames: Array.from(activatedRuntime.handlers.keys())
      }
    });
  } catch (error) {
    postToMain({
      type: 'activation_result',
      requestId: message.requestId,
      ok: false,
      error: relativizeErrorLocation(serializePluginError(error))
    });
  }
};

const handleInvoke = async (message: Extract<MainToWorkerMessage, { type: 'invoke' }>): Promise<void> => {
  try {
    if (!runtime) {
      throw new Error('Plugin worker runtime has not been activated');
    }
    const handler = runtime.handlers.get(message.input.invoke);
    if (!handler) {
      throw new Error(`Plugin handler not found: ${message.input.invoke}`);
    }
    const result = await handler(message.input.payload);
    postToMain({
      type: 'invoke_result',
      requestId: message.requestId,
      ok: true,
      result
    });
  } catch (error) {
    postToMain({
      type: 'invoke_result',
      requestId: message.requestId,
      ok: false,
      error: relativizeErrorLocation(serializePluginError(error))
    });
  }
};

const handleDeactivate = async (message: Extract<MainToWorkerMessage, { type: 'deactivate' }>): Promise<void> => {
  try {
    if (deactivateHook) {
      await deactivateHook();
      deactivateHook = null;
    }
    postToMain({ type: 'deactivate_result', requestId: message.requestId, ok: true });
  } catch (error) {
    postToMain({
      type: 'deactivate_result',
      requestId: message.requestId,
      ok: false,
      error: relativizeErrorLocation(serializePluginError(error))
    });
  }
};

port.on('message', (raw: unknown) => {
  let message: MainToWorkerMessage;
  try {
    message = parseMainToWorkerMessage(raw);
  } catch (error) {
    postToMain({
      type: 'log',
      level: 'error',
      message: 'Invalid plugin worker message received',
      fields: { error: serializePluginError(error) }
    });
    return;
  }

  switch (message.type) {
    case 'activate':
      void handleActivate(message);
      break;
    case 'invoke':
      void handleInvoke(message);
      break;
    case 'host_result':
      handleHostResult(message);
      break;
    case 'deactivate':
      void handleDeactivate(message);
      break;
  }
});
