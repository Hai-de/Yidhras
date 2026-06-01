export interface SourceLocation {
  file: string;
  line?: number;
  column?: number;
}

/**
 * 从 V8 stack trace 的第一帧解析源文件位置。
 * 支持格式：
 *   at FuncName (/path/to/file.ts:42:10)
 *   at /path/to/file.ts:42:10
 *   at file:///path/to/file.ts:42:10
 */
export const parseSourceLocationFromStack = (stack: string): SourceLocation | undefined => {
  const lines = stack.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('at ')) continue;

     
    const match = trimmed.match(
      /at\s+(?:(?:async\s+)?(?:\S+)\s+\()?(?:file:\/\/)?([^(:]+?)(?::(\d+))?(?::(\d+))?\)?$/
    );
    if (match && match[1]) {
      const result: SourceLocation = { file: match[1].trim() };
      if (match[2]) result.line = Number(match[2]);
      if (match[3]) result.column = Number(match[3]);
      return result;
    }
  }
  return undefined;
};

/**
 * 从错误对象提取源位置。
 * 优先取序列化时挂载的 source_location，回退从 stack 解析。
 */
export function extractSourceLocation(error: unknown): SourceLocation | undefined {
  if (typeof error === 'object' && error !== null) {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- extracting optional source_location from dynamic object
    const loc = (error as Record<string, unknown>)['source_location'];
    if (loc && typeof loc === 'object') {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- structural type extraction
      const sl = loc as Record<string, unknown>;
      if (typeof sl['file'] === 'string') {
        const result: SourceLocation = { file: sl['file'] };
        if (typeof sl['line'] === 'number') result.line = sl['line'];
        if (typeof sl['column'] === 'number') result.column = sl['column'];
        return result;
      }
    }
  }
  // 回退：从 stack 解析
  if (error instanceof Error && error.stack) {
    return parseSourceLocationFromStack(error.stack);
  }
  return undefined;
}

export interface ErrorMetadata {
  source_location?: SourceLocation;
  cause?: unknown;
}

/**
 * 安全挂载 source_location 和 cause 到 Error 对象。
 * 用于跨线程/跨序列化边界保留错误上下文。
 */
export function attachErrorMetadata(error: Error, meta: ErrorMetadata): void {
  if (meta.source_location) {
    Object.defineProperty(error, 'source_location', {
      value: meta.source_location,
      writable: true,
      enumerable: true,
      configurable: true
    });
  }
  if (meta.cause !== undefined) {
    Object.defineProperty(error, 'cause', {
      value: meta.cause,
      writable: true,
      enumerable: true,
      configurable: true
    });
  }
}

/**
 * 将绝对路径转换为相对路径（相对于给定的基准目录）。
 * 如果路径不在基准目录下，返回原路径。
 */
export const relativizePath = (filePath: string, baseDir: string): string => {
  const normalizedBase = baseDir.endsWith('/') ? baseDir : baseDir + '/';
  if (filePath.startsWith(normalizedBase)) {
    return filePath.slice(normalizedBase.length);
  }
  if (filePath.startsWith('file://')) {
    const fileUrl = filePath.slice(7);
    if (fileUrl.startsWith(normalizedBase)) {
      return fileUrl.slice(normalizedBase.length);
    }
  }
  return filePath;
};
