import type { PermissionContext } from '../../permission/types.js';
import { NarrativeResolver } from '../../narrative/resolver.js';
import type { VariablePool } from '../../narrative/types.js';

export const renderTemplateWithVisibleVariables = (
  template: string,
  visibleVariables: VariablePool,
  extraContext: VariablePool = {},
  permission?: PermissionContext
): string => {
  const resolver = new NarrativeResolver(visibleVariables);
  return resolver.resolve(template, extraContext, permission);
};
