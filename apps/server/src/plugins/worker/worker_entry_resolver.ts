import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import path, { dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

export interface WorkerEntryResolution {
  workerUrl: URL;
  /** --import flags needed for tsx/dev mode to load TypeScript in the Worker */
  execArgv?: string[];
}

const resolveTsxLoaderPath = (): string | undefined => {
  try {
    return createRequire(import.meta.url).resolve('tsx');
  } catch {
    return undefined;
  }
};

export const resolvePluginWorkerEntry = (): WorkerEntryResolution => {
  const jsPath = path.join(__dirname, 'worker_entry.js');
  if (existsSync(jsPath)) {
    return { workerUrl: pathToFileURL(jsPath) };
  }

  // Dev mode: no compiled .js next to .ts source.
  // Try the dist/ directory first — tsx in Worker threads does not
  // reliably remap .js imports to .ts (Node.js/tsx compatibility gap),
  // so we run the pre-compiled worker entry. The execArgv is still
  // needed so the Worker can import() the plugin's .ts source at runtime.
  const distJsPath = path.resolve(__dirname, '..', '..', '..', 'dist', 'plugins', 'worker', 'worker_entry.js');
  if (existsSync(distJsPath)) {
    const execArgv: string[] | undefined = (() => {
      const loaderPath = resolveTsxLoaderPath();
      if (!loaderPath) return undefined;
      return ['--import', loaderPath];
    })();
    return { workerUrl: pathToFileURL(distJsPath), ...(execArgv ? { execArgv } : {}) };
  }

  // Last resort: load .ts directly via tsx (may fail for .js → .ts remapping)
  const execArgv: string[] | undefined = (() => {
    const loaderPath = resolveTsxLoaderPath();
    if (!loaderPath) return undefined;
    return ['--import', loaderPath];
  })();

// @ts-expect-error -- EOPT strict mode
  return {
    workerUrl: pathToFileURL(path.join(__dirname, 'worker_entry.ts')),
    execArgv
  };
};

/** @deprecated Use resolvePluginWorkerEntry() for dev/dist-aware resolution */
export const resolvePluginWorkerEntryUrl = (): URL => {
  return resolvePluginWorkerEntry().workerUrl;
};
