/** 运行时校验 value 是普通对象记录（非 null、非数组） */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * 边界穿越：将 unknown 值断言为目标类型。
 * 仅用于系统边界不可消除的断言点（JSON.parse 返回值、Prisma JSON 列、外部 API 响应）。
 * 调用点不会被 no-unsafe-type-assertion 标记——断言集中在函数体内用 eslint-disable 管理。
 */
export function boundaryCast<T>(_value: unknown): T {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
  return _value as T;
}
