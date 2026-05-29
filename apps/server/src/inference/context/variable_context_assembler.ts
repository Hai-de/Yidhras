import { buildPreviousAgentOutputTemplateScope } from '../../app/services/workflow/workflow_previous_output.js';
import type {
  PromptVariableContext,
  PromptVariableNamespace} from '../../template_engine/frontends/narrative/types.js';
import {
  createPromptVariableContext,
  createPromptVariableContextSummary,
  createPromptVariableLayer,
  flattenPromptVariableContextToVisibleVariables,
  normalizePromptVariableRecord
} from '../../template_engine/frontends/narrative/variable_context.js';
import { type InferenceContextConfig,resolveConfigValues } from './config_loader.js';
import type { VariableContextInput } from './types.js';

const LAYER_ORDER: PromptVariableNamespace[] = [
  'system',
  'app',
  'pack',
  'runtime',
  'actor',
  'request'
];

export const assembleVariableContext = (input: VariableContextInput, config?: InferenceContextConfig): PromptVariableContext => {
  const resolvedConfig = config?.variable_context;

  const runtimeObjects: Record<string, unknown> = {
    app: {
      startup_health: {
        level: 'operational',
        available_world_packs: []
      }
    },
    pack: {
      metadata: input.pack.metadata,
      variables: input.pack.variables ?? {},
      prompts: input.pack.prompts ?? {},
      ai: input.pack.ai ?? null
    },
    runtime: {
      current_tick: input.currentTick,
      pack_state: input.packState,
      pack_runtime: input.packRuntime
    },
    actor: {
      identity: input.actor.identity,
      display_name: input.actor.actor_display_name,
      role: input.actor.actor_ref.role,
      binding_ref: input.actor.binding_ref,
      agent_id: input.actor.resolved_agent_id,
      agent_snapshot: input.actor.agent_snapshot
    },
    previous_agent_output: buildPreviousAgentOutputTemplateScope(
      input.requestInput.previous_agent_output
    ),
    request: {
      strategy: input.strategy,
      attributes: input.attributes,
      agent_id: input.requestInput.agent_id ?? null,
      identity_id: input.requestInput.identity_id ?? null,
      idempotency_key: input.requestInput.idempotency_key ?? null
    }
  };

  const configuredLayers = resolvedConfig?.layers;

  const layers = LAYER_ORDER
    .map((namespace) => {
      const layerConfig = configuredLayers?.[namespace];
      if (!layerConfig) return null;
      if (!layerConfig.enabled) return null;

      const values = resolveConfigValues(layerConfig.values, runtimeObjects);
      const aliasValues = layerConfig.alias_values
        ? resolveConfigValues(layerConfig.alias_values, runtimeObjects)
        : {};

      const isRequest = namespace === 'request';

      return createPromptVariableLayer({
        namespace,
        values: normalizePromptVariableRecord(values),
        alias_values: normalizePromptVariableRecord(aliasValues),
        metadata: {
          source_label: isRequest ? 'inference-request' : `${namespace}-config`,
          ...(isRequest ? { mutable: true } : {}),
          trusted: true
        }
      });
    })
    .filter((layer): layer is NonNullable<typeof layer> => layer !== null);

  // Append previous_agent_output layer when output data is present
  const previousAgentOutputValues = runtimeObjects.previous_agent_output as Record<string, unknown>;
  if (Object.keys(previousAgentOutputValues).length > 0) {
    layers.push(
      createPromptVariableLayer({
        namespace: 'previous_agent_output',
        values: normalizePromptVariableRecord(previousAgentOutputValues),
        alias_values: {
          previous_agent_output: normalizePromptVariableRecord(previousAgentOutputValues)
        },
        metadata: {
          source_label: 'workflow-previous-agent-output',
          trusted: true
        }
      })
    );
  }

  return createPromptVariableContext({ layers });
};

export {
  createPromptVariableContext,
  createPromptVariableContextSummary,
  createPromptVariableLayer,
  flattenPromptVariableContextToVisibleVariables,
  normalizePromptVariableRecord
};
