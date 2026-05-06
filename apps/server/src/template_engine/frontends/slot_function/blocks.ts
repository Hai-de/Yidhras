import type { AstNode, BlockHandlerFn, RenderScope } from '../../core/types.js';
import type { SlotRegistry } from './types.js';

interface SlotFunctionRenderScope extends RenderScope {
  slotRegistry?: SlotRegistry;
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
  const slotRegistry = (scope as SlotFunctionRenderScope).slotRegistry;
  const slot = slotRegistry?.[slotName];

  if (!slot) return '';
  if (slot.enabled) return slot.content;
  if (body.length > 0) return renderFn(body, scope);
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
