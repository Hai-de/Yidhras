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

  // Dev/tsx mode: no compiled .js entry. Return the .ts entry with
  // --import tsx so the Worker thread can load TypeScript.
  // Note: .js → .ts import remapping inside the Worker may not fully work
  // in all Node.js/tsx version combinations. The dist-mode path is the
  // tested production path.
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
