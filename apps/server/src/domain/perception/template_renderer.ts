import type { PermissionContext } from '../../permission/types.js';
import { renderNarrativeTemplate } from '../../template_engine/frontends/narrative/resolver.js';
import type { PromptVariableContext, PromptVariableRecord } from '../../template_engine/frontends/narrative/types.js';
import {
  createPromptVariableContext,
  createPromptVariableLayer,
  normalizePromptVariableRecord
} from '../../template_engine/frontends/narrative/variable_context.js';

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

// @ts-expect-error -- EOPT strict mode
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
// @ts-expect-error -- EOPT strict mode
  return renderNarrativeTemplate({
    template,
    variableContext,
    extraContext,
    permission,
    templateSource: 'perception.template'
  }).text;
};
