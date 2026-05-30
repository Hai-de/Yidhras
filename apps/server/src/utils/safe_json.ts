/**
 * 类型安全的 JSON.parse 替代。
 *
 * JSON.parse() 返回 `any` 是 TypeScript 标准库的已知设计缺陷。
 * 此函数显式声明返回 `unknown`，强制调用方进行运行时类型验证。
 *
 * 用法:
 *   const parsed = safeJsonParse(input);
 *   if (isRecord(parsed)) { ... }  // 类型守卫窄化
 *
 *   或配合 Zod:
 *   const data = safeJsonParseWith(input, mySchema);
 */
export function safeJsonParse(input: string): unknown {
   
  return JSON.parse(input) as unknown;
}

/**
 * 带 Zod 验证的 JSON.parse。
 * 一行完成 parse + validate，消除手动类型守卫样板。
 */
export function safeJsonParseWith<T>(input: string, schema: { parse: (v: unknown) => T }): T {
   
  return schema.parse(JSON.parse(input) as unknown);
}
