/* eslint-disable security/detect-non-literal-fs-filename */
/**
 * Centralized path validation boundary. All runtime filesystem access must go
 * through this module so path traversal is checked in one place.
 *
 * fs security rules are suppressed ONLY in this file — every other module
 * should import safeFs instead of calling node:fs directly for path-based ops.
 */

import fs from 'node:fs';
import path from 'node:path';

import { AppError, ErrorCode } from './errors.js';

// ── SafeFsError ──────────────────────────────────────────────────────────────

export class SafeFsError extends AppError {
  readonly fsOperation: string;
  readonly targetPath: string;

  constructor(
    code: string,
    message: string,
    fsOperation: string,
    targetPath: string,
    options?: { cause?: Error }
  ) {
    const opts: { cause?: Error; context?: Record<string, unknown> } = {};
    if (options?.cause !== undefined) {
      opts.cause = options.cause;
    }
    opts.context = { fs_operation: fsOperation, target_path: targetPath };
    super(code, message, opts);
    this.name = 'SafeFsError';
    this.fsOperation = fsOperation;
    this.targetPath = targetPath;
  }
}

// ── Path traversal guard ─────────────────────────────────────────────────────

const wrapNativeError = (
  err: unknown,
  operation: string,
  targetPath: string
): SafeFsError => {
  if (err instanceof SafeFsError) {
    return err;
  }
  const message = err instanceof Error ? err.message : String(err);
  const causeErr = err instanceof Error ? err : undefined;
  const opts: { cause?: Error } = {};
  if (causeErr !== undefined) {
    opts.cause = causeErr;
  }
  return new SafeFsError(
    ErrorCode.STORAGE_QUERY_FAIL,
    message,
    operation,
    targetPath,
    opts
  );
};

function assertInBase(fullPath: string, baseDir: string): string {
  const resolved = path.resolve(fullPath);
  const resolvedBase = path.resolve(baseDir);
  const sep = path.sep;
  if (resolved !== resolvedBase && !resolved.startsWith(resolvedBase + sep)) {
    throw new SafeFsError(
      ErrorCode.PARSE_FAIL,
      `Path traversal rejected: "${fullPath}" resolves outside base "${baseDir}"`,
      'resolve',
      resolved
    );
  }
  return resolved;
}

// ── readdir overload wrapper ─────────────────────────────────────────────────

function readdirWrapper(baseDir: string, dirPath: string): string[];
function readdirWrapper(baseDir: string, dirPath: string, options: { withFileTypes: true }): fs.Dirent[];
function readdirWrapper(
  baseDir: string,
  dirPath: string,
  options?: BufferEncoding | { withFileTypes?: boolean } | null
): string[] | fs.Dirent[] {
  const resolved = assertInBase(dirPath, baseDir);
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-type-assertion -- Node.js fs overload resolution
    return fs.readdirSync(resolved, options as any);
  } catch (err: unknown) {
    throw wrapNativeError(err, 'readdir', resolved);
  }
}

// ── Public API ───────────────────────────────────────────────────────────────

export const safeFs = {
  /** Validate that `fullPath` is within `baseDir` and return the resolved absolute path. */
  inBase(baseDir: string, fullPath: string): string {
    return assertInBase(fullPath, baseDir);
  },

  /** `path.join` then validate the result is within `baseDir`. */
  joinInBase(baseDir: string, ...segments: string[]): string {
    return assertInBase(path.join(baseDir, ...segments), baseDir);
  },

  existsSync(baseDir: string, fullPath: string): boolean {
    const resolved = assertInBase(fullPath, baseDir);
    try {
      return fs.existsSync(resolved);
    } catch (err: unknown) {
      throw wrapNativeError(err, 'exists', resolved);
    }
  },

  mkdirSync(baseDir: string, dirPath: string, options?: fs.MakeDirectoryOptions): string | undefined {
    const resolved = assertInBase(dirPath, baseDir);
    try {
      return fs.mkdirSync(resolved, options);
    } catch (err: unknown) {
      throw wrapNativeError(err, 'mkdir', resolved);
    }
  },

  readFileSync(baseDir: string, filePath: string, encoding?: BufferEncoding): string {
    const resolved = assertInBase(filePath, baseDir);
    try {
      return fs.readFileSync(resolved, encoding ?? 'utf-8');
    } catch (err: unknown) {
      throw wrapNativeError(err, 'readFile', resolved);
    }
  },

  writeFileSync(baseDir: string, filePath: string, data: string | NodeJS.ArrayBufferView): void {
    const resolved = assertInBase(filePath, baseDir);
    try {
      fs.writeFileSync(resolved, data);
    } catch (err: unknown) {
      throw wrapNativeError(err, 'writeFile', resolved);
    }
  },

  unlinkSync(baseDir: string, filePath: string): void {
    const resolved = assertInBase(filePath, baseDir);
    try {
      fs.unlinkSync(resolved);
    } catch (err: unknown) {
      throw wrapNativeError(err, 'unlink', resolved);
    }
  },

  readdirSync: readdirWrapper,

  statSync(baseDir: string, filePath: string): fs.Stats {
    const resolved = assertInBase(filePath, baseDir);
    try {
      return fs.statSync(resolved);
    } catch (err: unknown) {
      throw wrapNativeError(err, 'stat', resolved);
    }
  },

  copyFileSync(baseDir: string, src: string, dest: string): void {
    const resolvedSrc = assertInBase(src, baseDir);
    const resolvedDest = assertInBase(dest, baseDir);
    try {
      fs.copyFileSync(resolvedSrc, resolvedDest);
    } catch (err: unknown) {
      throw wrapNativeError(err, 'copyFile', resolvedSrc);
    }
  },

  rmSync(baseDir: string, dirPath: string, options?: fs.RmOptions): void {
    const resolved = assertInBase(dirPath, baseDir);
    try {
      fs.rmSync(resolved, options);
    } catch (err: unknown) {
      throw wrapNativeError(err, 'rm', resolved);
    }
  }
};
