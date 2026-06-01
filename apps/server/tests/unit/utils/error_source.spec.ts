import { describe, expect, it } from 'vitest';

import {
  attachErrorMetadata,
  extractSourceLocation,
  parseSourceLocationFromStack,
  relativizePath
} from '../../../src/utils/error_source.js';

describe('parseSourceLocationFromStack', () => {
  it('parses "at FuncName (file:line:column)" format', () => {
    const stack = 'Error: test\n    at doSomething (/home/user/src/handler.ts:42:10)\n    at main (/home/user/src/index.ts:5:1)';
    const result = parseSourceLocationFromStack(stack);
    expect(result).toEqual({ file: '/home/user/src/handler.ts', line: 42, column: 10 });
  });

  it('parses "at file:line:column" format (no function name)', () => {
    const stack = 'Error: test\n    at /home/user/src/handler.ts:42:10\n    at main';
    const result = parseSourceLocationFromStack(stack);
    expect(result).toEqual({ file: '/home/user/src/handler.ts', line: 42, column: 10 });
  });

  it('parses file:// URL format', () => {
    const stack = 'Error: test\n    at doSomething (file:///home/user/src/handler.ts:42:10)';
    const result = parseSourceLocationFromStack(stack);
    expect(result).toEqual({ file: '/home/user/src/handler.ts', line: 42, column: 10 });
  });

  it('handles stack without line/column', () => {
    const stack = 'Error: test\n    at /home/user/src/handler.ts';
    const result = parseSourceLocationFromStack(stack);
    expect(result).toEqual({ file: '/home/user/src/handler.ts', line: undefined, column: undefined });
  });

  it('returns undefined for empty stack', () => {
    const result = parseSourceLocationFromStack('');
    expect(result).toBeUndefined();
  });

  it('returns undefined for Windows paths with drive letters (regex targets V8 Unix-style)', () => {
    const stack = 'Error: test\n    at doSomething (C:\\Users\\test\\handler.ts:42:10)';
    const result = parseSourceLocationFromStack(stack);
    // V8 stack frame regex does not handle Windows drive letters; expected to return undefined
    expect(result).toBeUndefined();
  });
});

describe('extractSourceLocation', () => {
  it('prefers attached source_location over stack parsing', () => {
    const error = new Error('test');
    error.stack = 'Error: test\n    at /real/path.ts:10:1';
    (error as Record<string, unknown>)['source_location'] = { file: 'preferred.ts', line: 5 };

    const result = extractSourceLocation(error);
    expect(result).toEqual({ file: 'preferred.ts', line: 5, column: undefined });
  });

  it('falls back to stack parsing when no attached source_location', () => {
    const error = new Error('test');
    error.stack = 'Error: test\n    at /home/user/src/handler.ts:42:10';
    const result = extractSourceLocation(error);
    expect(result).toEqual({ file: '/home/user/src/handler.ts', line: 42, column: 10 });
  });

  it('returns undefined for non-Error values without source_location', () => {
    const result = extractSourceLocation('just a string');
    expect(result).toBeUndefined();
  });

  it('returns undefined for plain object without source_location', () => {
    const result = extractSourceLocation({ message: 'test' });
    expect(result).toBeUndefined();
  });
});

describe('attachErrorMetadata', () => {
  it('attaches source_location to error', () => {
    const error = new Error('test');
    attachErrorMetadata(error, { source_location: { file: 'handler.ts', line: 42 } });
    const loc = (error as Record<string, unknown>)['source_location'];
    expect(loc).toEqual({ file: 'handler.ts', line: 42 });
  });

  it('attaches cause to error', () => {
    const error = new Error('test');
    const cause = { message: 'root cause' };
    attachErrorMetadata(error, { cause });
    expect((error as Record<string, unknown>)['cause']).toBe(cause);
  });

  it('does not attach undefined cause', () => {
    const error = new Error('test');
    attachErrorMetadata(error, {});
    expect((error as Record<string, unknown>)['cause']).toBeUndefined();
  });
});

describe('relativizePath', () => {
  it('converts absolute path to relative', () => {
    const result = relativizePath('/home/user/project/src/handler.ts', '/home/user/project/');
    expect(result).toBe('src/handler.ts');
  });

  it('handles base without trailing slash', () => {
    const result = relativizePath('/home/user/project/src/handler.ts', '/home/user/project');
    expect(result).toBe('src/handler.ts');
  });

  it('returns original path if not under base', () => {
    const result = relativizePath('/other/dir/handler.ts', '/home/user/project/');
    expect(result).toBe('/other/dir/handler.ts');
  });

  it('handles file:// URL prefix', () => {
    const result = relativizePath('file:///home/user/project/src/handler.ts', '/home/user/project');
    expect(result).toBe('src/handler.ts');
  });
});
