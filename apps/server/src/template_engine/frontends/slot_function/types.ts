export interface SlotRegistration {
  content: string;
  enabled: boolean;
  /** 禁止自引用 — 当前插槽内容中不允许 slot-ref 引用自身 */
  no_recursion?: boolean | undefined;
  /** 最大渲染深度 — 限制 slot-ref 嵌套层级 */
  max_depth?: number | undefined;
  /** 防止进一步递归 — 当前插槽被引用时不再触发 slot-ref 解析 */
  prevent_further_recursion?: boolean | undefined;
}

export type SlotRegistry = Record<string, SlotRegistration>;

export interface SlotFunctionContext {
  slots: SlotRegistry;
}
