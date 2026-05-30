import type { AstNode, BlockHandlerFn, RenderScope } from '../../core/types.js';
import type { SlotRegistry } from './types.js';

interface SlotFunctionRenderScope extends RenderScope {
  slotRegistry?: SlotRegistry;
  /** 禁止自引用的插槽集合 */
  noRecursionSlots?: Set<string>;
  /** 当前 slot-ref 调用栈（用于递归检测） */
  currentSlotStack?: string[];
  /** 防止进一步递归 — 设置后不再解析子 slot-ref */
  preventFurtherRecursion?: boolean;
  /** 诊断信息收集 */
  diagnostics?: {
    errors: { code: string; message: string; path: string }[];
  };
}

const parseSlotRefCondition = (condition: string): string => {
  const trimmed = condition.trim();
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
};

export const slotRefBlockHandler: BlockHandlerFn = (
  condition: string,
  body: AstNode[],
  _elseBody: AstNode[] | undefined,
  scope: RenderScope,
  renderFn: (nodes: AstNode[], scope: RenderScope) => string
): string => {
  const slotName = parseSlotRefCondition(condition);
  const sfScope = scope as SlotFunctionRenderScope;
  const slotRegistry = sfScope.slotRegistry;
  // eslint-disable-next-line security/detect-object-injection -- slot 名来自已解析 block 条件，访问受控 slot 注册表是正式能力
  const slot = slotRegistry?.[slotName];

  if (!slot) return '';

  // Phase 3: recursion constraints
  // no_recursion — 当前插槽禁止自引用
  if (sfScope.noRecursionSlots?.has(slotName)) {
    sfScope.diagnostics?.errors.push({
      code: 'RECURSION_BLOCKED',
      message: `Slot '${slotName}' has no_recursion constraint`,
      path: slotName
    });
    return '';
  }

  // 递归检测 — 当前调用栈已包含此插槽
  if (sfScope.currentSlotStack?.includes(slotName)) {
    sfScope.diagnostics?.errors.push({
      code: 'RECURSION_DETECTED',
      message: `Recursive slot-ref detected: '${slotName}'`,
      path: slotName
    });
    return '';
  }

  // max_depth — 限制嵌套层级
  if (slot.max_depth !== undefined && scope.depth >= slot.max_depth) {
    return '';
  }

  // prevent_further_recursion — 设置后不再解析子 slot-ref
  if (sfScope.preventFurtherRecursion) {
    return slot.enabled ? slot.content : (body.length > 0 ? renderFn(body, scope) : '');
  }

  if (slot.enabled) return slot.content;
  if (body.length > 0) {
    // 传递递归约束到子渲染
// @ts-expect-error -- EOPT strict mode
    const childScope: SlotFunctionRenderScope = {
      ...sfScope,
      currentSlotStack: [...(sfScope.currentSlotStack ?? []), slotName],
      depth: scope.depth + 1,
      // 如果引用的插槽标记了 prevent_further_recursion，传播到子作用域
      preventFurtherRecursion: slot.prevent_further_recursion === true ? true : sfScope.preventFurtherRecursion
    };
    return renderFn(body, childScope);
  }
  return '';
};

export const scopeBlockHandler: BlockHandlerFn = (
  _condition: string,
  _body: AstNode[],
  _elseBody: AstNode[] | undefined,
  _scope: RenderScope,
  _renderFn: (nodes: AstNode[], scope: RenderScope) => string
): string => {
  return '';
};
