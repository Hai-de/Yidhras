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

function assertInBase(fullPath: string, baseDir: string): string {
  const resolved = path.resolve(fullPath);
  const resolvedBase = path.resolve(baseDir);
  const sep = path.sep;
  if (resolved !== resolvedBase && !resolved.startsWith(resolvedBase + sep)) {
    throw new Error(
      `[safe_fs] Path traversal rejected: "${fullPath}" resolves outside base "${baseDir}"`
    );
  }
  return resolved;
}

// eslint-disable-next-line security/detect-non-literal-fs-filename
function readdirWrapper(baseDir: string, dirPath: string): string[];
function readdirWrapper(baseDir: string, dirPath: string, options: { withFileTypes: true }): fs.Dirent[];
function readdirWrapper(
  baseDir: string,
  dirPath: string,
  options?: BufferEncoding | { withFileTypes?: boolean } | null
): string[] | fs.Dirent[] {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-argument
  return fs.readdirSync(assertInBase(dirPath, baseDir), options as any);
}

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
    return fs.existsSync(assertInBase(fullPath, baseDir));
  },

mkdirSync(baseDir: string, dirPath: string, options?: fs.MakeDirectoryOptions): string | undefined {
    return fs.mkdirSync(assertInBase(dirPath, baseDir), options);
  },

readFileSync(baseDir: string, filePath: string, encoding?: BufferEncoding): string {
    return fs.readFileSync(assertInBase(filePath, baseDir), encoding ?? 'utf-8');
  },

writeFileSync(baseDir: string, filePath: string, data: string | NodeJS.ArrayBufferView): void {
    fs.writeFileSync(assertInBase(filePath, baseDir), data);
  },

unlinkSync(baseDir: string, filePath: string): void {
    fs.unlinkSync(assertInBase(filePath, baseDir));
  },

  readdirSync: readdirWrapper,

statSync(baseDir: string, filePath: string): fs.Stats {
    return fs.statSync(assertInBase(filePath, baseDir));
  },

copyFileSync(baseDir: string, src: string, dest: string): void {
    fs.copyFileSync(assertInBase(src, baseDir), assertInBase(dest, baseDir));
  },

rmSync(baseDir: string, dirPath: string, options?: fs.RmOptions): void {
    fs.rmSync(assertInBase(dirPath, baseDir), options);
  }
};
