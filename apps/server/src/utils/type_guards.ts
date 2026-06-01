import type { z } from 'zod';

/** 运行时校验 value 是普通对象记录（非 null、非数组） */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * 运行时解析：将 unknown 值通过 Zod schema 验证后断言为目标类型。
 * 用于 JSON.parse 返回值、Prisma JSON 列、外部 API 响应等不可消除的系统边界。
 * 调用点不会被 no-unsafe-type-assertion 标记——断言集中在函数体内管理。
 */
export function parseAs<T>(value: unknown, schema: z.ZodType<T>): T {
  return schema.parse(value);
}

/**
 * 安全记录转换：验证 value 是普通对象后返回为 Record<string, unknown>。
 * 替代 as unknown as Record<string, unknown> 模式。
 * 失败时抛出 TypeError。
 */
export function asRecord(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new TypeError(`Expected plain object record, got ${typeof value === 'object' && value !== null ? (Array.isArray(value) ? 'array' : value.constructor?.name ?? 'object') : typeof value}`);
  }
  return value;
}

/**
 * 安全记录转换（可空变体）：若 value 为 null/undefined 返回 null。
 * 用于可选字段的 Record<string, unknown> 转换。
 */
export function asRecordOrNull(value: unknown): Record<string, unknown> | null {
  if (value === null || value === undefined) {
    return null;
  }
  return asRecord(value);
}

/**
 * Prisma 动态参数强制转换：将 Record<string, unknown> 等动态对象
 * 传递给 Prisma 严格类型参数时使用。Prisma 生成的类型不接受宽松的
 * Record 类型，此函数将调用点的不安全断言集中化管理。
 * 仅用于仓储层 Prisma 查询参数，不应用于业务逻辑。
 *
 * 返回 never 类型——never 可赋值给任意类型，使调用点无需指定泛型
 * 就可以满足 Prisma 的参数类型约束。
 */
 
 
export function prismaInput(_value: unknown): never {
  return _value as never;
}
