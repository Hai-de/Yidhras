import {
  collectDefaultMetrics,
  Counter,
  Gauge,
  Histogram,
  register,
  type Registry
} from 'prom-client';

const metricsRegistry: Registry = register;
let metricsInitialized = false;

export const getMetricsRegistry = (): Registry => metricsRegistry;

export const initMetrics = (): void => {
  if (metricsInitialized) {
    return;
  }
  collectDefaultMetrics({ register: metricsRegistry, prefix: 'yidhras_' });
  metricsInitialized = true;
};

const tickDurationMs = new Histogram({
  name: 'yidhras_tick_duration_ms',
  help: 'Duration of each sim loop step in milliseconds',
  labelNames: ['pack_id', 'step'],
  registers: [metricsRegistry]
});

const tickTotal = new Counter({
  name: 'yidhras_tick_total',
  help: 'Total number of sim loop ticks completed',
  labelNames: ['pack_id', 'status'],
  registers: [metricsRegistry]
});

const inferenceDurationMs = new Histogram({
  name: 'yidhras_inference_duration_ms',
  help: 'Duration of AI inference calls in milliseconds',
  labelNames: ['pack_id', 'model', 'task_type'],
  registers: [metricsRegistry]
});

const inferenceTotal = new Counter({
  name: 'yidhras_inference_total',
  help: 'Total number of AI inference calls',
  labelNames: ['pack_id', 'model', 'status'],
  registers: [metricsRegistry]
});

const actionIntentsDispatched = new Counter({
  name: 'yidhras_action_intents_dispatched',
  help: 'Total number of action intents dispatched',
  labelNames: ['pack_id', 'intent_type', 'outcome'],
  registers: [metricsRegistry]
});

const pluginsActive = new Gauge({
  name: 'yidhras_plugins_active',
  help: 'Number of currently active plugins per pack',
  labelNames: ['pack_id'],
  registers: [metricsRegistry]
});

const pluginWorkersActive = new Gauge({
  name: 'yidhras_plugin_workers_active',
  help: 'Number of currently active plugin Worker threads per pack',
  labelNames: ['pack_id'],
  registers: [metricsRegistry]
});

const pluginWorkerCrashesTotal = new Counter({
  name: 'yidhras_plugin_worker_crashes_total',
  help: 'Total number of plugin Worker crashes',
  labelNames: ['pack_id', 'plugin_id', 'installation_id'],
  registers: [metricsRegistry]
});

const pluginWorkerInvocationDurationMs = new Histogram({
  name: 'yidhras_plugin_worker_invocation_duration_ms',
  help: 'Duration of plugin Worker contribution invocations in milliseconds',
  labelNames: ['pack_id', 'plugin_id', 'installation_id', 'contribution_type', 'status'],
  registers: [metricsRegistry]
});

const pluginWorkerActivationDurationMs = new Histogram({
  name: 'yidhras_plugin_worker_activation_duration_ms',
  help: 'Duration of plugin Worker activation attempts in milliseconds',
  labelNames: ['pack_id', 'plugin_id', 'installation_id', 'status'],
  registers: [metricsRegistry]
});

const sidecarHealth = new Gauge({
  name: 'yidhras_sidecar_health',
  help: 'Health status of sidecar processes (1 = healthy, 0 = unhealthy)',
  labelNames: ['sidecar_name'],
  registers: [metricsRegistry]
});

export const recordTickCompleted = (
  packId: string,
  step: string,
  durationMs: number,
  status: 'success' | 'failed'
): void => {
  tickDurationMs.observe({ pack_id: packId, step }, durationMs);
  tickTotal.inc({ pack_id: packId, status });
};

export const recordInferenceCompleted = (
  packId: string,
  model: string,
  taskType: string,
  durationMs: number,
  status: 'success' | 'failed'
): void => {
  inferenceDurationMs.observe({ pack_id: packId, model, task_type: taskType }, durationMs);
  inferenceTotal.inc({ pack_id: packId, model, status });
};

export const recordActionIntentDispatched = (
  packId: string,
  intentType: string,
  outcome: 'completed' | 'dropped' | 'failed'
): void => {
  actionIntentsDispatched.inc({ pack_id: packId, intent_type: intentType, outcome });
};

export const setPluginsActive = (packId: string, count: number): void => {
  pluginsActive.set({ pack_id: packId }, count);
};

export const setPluginWorkersActive = (packId: string, count: number): void => {
  pluginWorkersActive.set({ pack_id: packId }, count);
};

export const recordPluginWorkerCrash = (
  packId: string,
  pluginId: string,
  installationId: string
): void => {
  pluginWorkerCrashesTotal.inc({
    pack_id: packId,
    plugin_id: pluginId,
    installation_id: installationId
  });
};

export const recordPluginWorkerInvocationCompleted = (
  packId: string,
  pluginId: string,
  installationId: string,
  contributionType: string,
  durationMs: number,
  status: 'success' | 'failed'
): void => {
  pluginWorkerInvocationDurationMs.observe({
    pack_id: packId,
    plugin_id: pluginId,
    installation_id: installationId,
    contribution_type: contributionType,
    status
  }, durationMs);
};

export const recordPluginWorkerActivationCompleted = (
  packId: string,
  pluginId: string,
  installationId: string,
  durationMs: number,
  status: 'success' | 'failed'
): void => {
  pluginWorkerActivationDurationMs.observe({
    pack_id: packId,
    plugin_id: pluginId,
    installation_id: installationId,
    status
  }, durationMs);
};

export const setSidecarHealth = (sidecarName: string, alive: boolean): void => {
  sidecarHealth.set({ sidecar_name: sidecarName }, alive ? 1 : 0);
};
