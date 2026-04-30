import { renderNarrativeTemplate } from '../../narrative/resolver.js';
import type { PromptVariableContext, PromptVariableRecord } from '../../narrative/types.js';
import {
  createPromptVariableContext,
  createPromptVariableLayer,
  normalizePromptVariableRecord
} from '../../narrative/variable_context.js';
import type { PermissionContext } from '../../permission/types.js';

export const renderTemplateWithVisibleVariables = (
  template: string,
  visibleVariables: PromptVariableRecord,
  extraContext: PromptVariableRecord = {},
  permission?: PermissionContext
): string => {
  const variableContext = createPromptVariableContext({
    layers: [
      createPromptVariableLayer({
        namespace: 'pack',
        values: normalizePromptVariableRecord(visibleVariables),
        alias_values: normalizePromptVariableRecord({
          ...visibleVariables,
          ...extraContext
        }),
        metadata: {
          source_label: 'perception-visible-variables',
          trusted: true
        }
      })
    ]
  });

  return renderNarrativeTemplate({
    template,
    variableContext,
    extraContext,
    permission,
    templateSource: 'perception.template'
  }).text;
};

export const renderTemplateWithVariableContext = (
  template: string,
  variableContext: PromptVariableContext,
  extraContext: Record<string, unknown> = {},
  permission?: PermissionContext
): string => {
  return renderNarrativeTemplate({
    template,
    variableContext,
    extraContext,
    permission,
    templateSource: 'perception.template'
  }).text;
};
