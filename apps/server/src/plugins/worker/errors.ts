export class PluginWorkerError extends Error {
  public readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'PluginWorkerError';
    this.code = code;
  }
}

export class PluginWorkerTimeoutError extends PluginWorkerError {
  constructor(message: string) {
    super('PLUGIN_WORKER_TIMEOUT', message);
    this.name = 'PluginWorkerTimeoutError';
  }
}

export class PluginWorkerProtocolError extends PluginWorkerError {
  constructor(message: string) {
    super('PLUGIN_WORKER_PROTOCOL_ERROR', message);
    this.name = 'PluginWorkerProtocolError';
  }
}

export class PluginWorkerCrashError extends PluginWorkerError {
  constructor(message: string) {
    super('PLUGIN_WORKER_CRASHED', message);
    this.name = 'PluginWorkerCrashError';
  }
}
