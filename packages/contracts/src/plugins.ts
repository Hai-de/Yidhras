import { z } from 'zod'

import { nonNegativeBigIntStringSchema } from './scalars.js'

const nonEmptyStringSchema = z.string().trim().min(1)
const semverStringSchema = nonEmptyStringSchema
const sourceTypeSchema = z.enum(['bundled_by_pack', 'standalone_local'])
const scopeTypeSchema = z.enum(['pack_local', 'global'])
const lifecycleStateSchema = z.enum([
  'discovered',
  'pending_confirmation',
  'confirmed_disabled',
  'enabled',
  'disabled',
  'upgrade_pending_confirmation',
  'error',
  'archived'
])
const trustModeSchema = z.enum(['trusted'])
const activationChannelSchema = z.enum(['startup_restore', 'cli_enable', 'ui_enable', 'api_enable'])
const acknowledgementChannelSchema = z.enum(['cli', 'ui', 'api'])
const entrypointRuntimeSchema = z.enum(['node_esm', 'browser_esm'])
const pluginManifestVersionSchema = z.literal('plugin/v1')

export const pluginCapabilityKeySchema = nonEmptyStringSchema

export const pluginAuditEventCodeSchema = z.enum([
  'plugin_discovered',
  'plugin_import_confirmed',
  'plugin_enable_warning_presented',
  'plugin_enable_acknowledged',
  'plugin_enabled',
  'plugin_disabled',
  'plugin_activation_failed',
  'plugin_upgrade_detected',
  'plugin_reconfirmation_required'
])

export const pluginServerContributionsSchema = z.object({
  context_sources: z.array(nonEmptyStringSchema).default([]),
  prompt_workflow_steps: z.array(nonEmptyStringSchema).default([]),
  intent_grounders: z.array(nonEmptyStringSchema).default([]),
  pack_projections: z.array(nonEmptyStringSchema).default([]),
  api_routes: z.array(nonEmptyStringSchema).default([])
})

export const pluginWebPanelContributionSchema = z.object({
  target: nonEmptyStringSchema,
  panel_id: nonEmptyStringSchema
})

export const pluginWebContributionsSchema = z.object({
  panels: z.array(pluginWebPanelContributionSchema).default([]),
  routes: z.array(nonEmptyStringSchema).default([]),
  menu_items: z.array(nonEmptyStringSchema).default([])
})

export const pluginWebManifestItemSchema = z.object({
  installation_id: nonEmptyStringSchema,
  plugin_id: nonEmptyStringSchema,
  pack_id: nonEmptyStringSchema,
  web_bundle_url: z.string().nullable(),
  contributions: pluginWebContributionsSchema,
  runtime_module: z.object({
    format: z.literal('browser_esm'),
    export_name: z.literal('default'),
    panel_export: z.literal('panels'),
    route_export: z.literal('routes')
  })
})

export const pluginEntrypointSchema = z.object({
  source: nonEmptyStringSchema.optional(),
  dist: nonEmptyStringSchema.optional(),
  runtime: entrypointRuntimeSchema
})

export const pluginManifestSchema = z.object({
  manifest_version: pluginManifestVersionSchema,
  id: nonEmptyStringSchema,
  name: nonEmptyStringSchema,
  version: semverStringSchema,
  kind: nonEmptyStringSchema,
  entrypoints: z
    .object({
      server: pluginEntrypointSchema.optional(),
      web: pluginEntrypointSchema.optional()
    })
    .superRefine((value, ctx) => {
      if (!value.server && !value.web) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'At least one of entrypoints.server or entrypoints.web is required',
          path: []
        })
      }
    }),
  compatibility: z.object({
    yidhras: nonEmptyStringSchema,
    pack_id: nonEmptyStringSchema
  }),
  requested_capabilities: z.array(pluginCapabilityKeySchema).default([]),
  contributions: z.object({
    server: pluginServerContributionsSchema.default({
      context_sources: [],
      prompt_workflow_steps: [],
      intent_grounders: [],
      pack_projections: [],
      api_routes: []
    }),
    web: pluginWebContributionsSchema.default({
      panels: [],
      routes: [],
      menu_items: []
    })
  }),
  metadata: z
    .object({
      author: nonEmptyStringSchema.optional(),
      homepage: nonEmptyStringSchema.optional(),
      description: nonEmptyStringSchema.optional()
    })
    .optional()
})

export const pluginArtifactSchema = z.object({
  artifact_id: nonEmptyStringSchema,
  plugin_id: nonEmptyStringSchema,
  version: semverStringSchema,
  manifest_version: pluginManifestVersionSchema,
  source_type: sourceTypeSchema,
  source_pack_id: nonEmptyStringSchema.optional(),
  source_path: nonEmptyStringSchema,
  checksum: nonEmptyStringSchema,
  manifest_json: z.record(z.string(), z.unknown()),
  imported_at: nonNegativeBigIntStringSchema
})

export const pluginInstallationSchema = z.object({
  installation_id: nonEmptyStringSchema,
  plugin_id: nonEmptyStringSchema,
  artifact_id: nonEmptyStringSchema,
  version: semverStringSchema,
  scope_type: scopeTypeSchema,
  scope_ref: nonEmptyStringSchema.optional(),
  lifecycle_state: lifecycleStateSchema,
  requested_capabilities: z.array(pluginCapabilityKeySchema),
  granted_capabilities: z.array(pluginCapabilityKeySchema),
  trust_mode: trustModeSchema,
  confirmed_at: nonNegativeBigIntStringSchema.optional(),
  enabled_at: nonNegativeBigIntStringSchema.optional(),
  disabled_at: nonNegativeBigIntStringSchema.optional(),
  last_error: nonEmptyStringSchema.optional()
})

export const pluginActivationSessionSchema = z.object({
  activation_id: nonEmptyStringSchema,
  installation_id: nonEmptyStringSchema,
  pack_id: nonEmptyStringSchema,
  channel: activationChannelSchema,
  result: z.enum(['success', 'failed']),
  started_at: nonNegativeBigIntStringSchema,
  finished_at: nonNegativeBigIntStringSchema.optional(),
  loaded_server: z.boolean(),
  loaded_web_manifest: z.boolean(),
  error_message: nonEmptyStringSchema.optional()
})

export const pluginEnableAcknowledgementSchema = z.object({
  acknowledgement_id: nonEmptyStringSchema,
  installation_id: nonEmptyStringSchema,
  pack_id: nonEmptyStringSchema,
  channel: acknowledgementChannelSchema,
  reminder_text_hash: nonEmptyStringSchema,
  acknowledged: z.boolean(),
  actor_id: nonEmptyStringSchema.optional(),
  actor_label: nonEmptyStringSchema.optional(),
  created_at: nonNegativeBigIntStringSchema
})

export const pluginEnableRequestSchema = z.object({
  acknowledgement: z.object({
    reminder_text_hash: nonEmptyStringSchema,
    actor_id: nonEmptyStringSchema.optional(),
    actor_label: nonEmptyStringSchema.optional()
  })
})

export const pluginImportConfirmRequestSchema = z.object({
  granted_capabilities: z.array(pluginCapabilityKeySchema).optional()
})

export const pluginPackParamsSchema = z.object({
  packId: nonEmptyStringSchema
})

export const pluginInstallationParamsSchema = z.object({
  installationId: nonEmptyStringSchema
})

export const pluginSummarySchema = z.object({
  installation_id: nonEmptyStringSchema,
  plugin_id: nonEmptyStringSchema,
  version: semverStringSchema,
  artifact_id: nonEmptyStringSchema,
  lifecycle_state: lifecycleStateSchema,
  scope_type: scopeTypeSchema,
  scope_ref: nonEmptyStringSchema.optional(),
  trust_mode: trustModeSchema,
  requested_capabilities: z.array(pluginCapabilityKeySchema),
  granted_capabilities: z.array(pluginCapabilityKeySchema),
  last_error: nonEmptyStringSchema.optional(),
  confirmed_at: nonNegativeBigIntStringSchema.optional(),
  enabled_at: nonNegativeBigIntStringSchema.optional(),
  disabled_at: nonNegativeBigIntStringSchema.optional()
})

export const pluginListResponseDataSchema = z.object({
  pack_id: nonEmptyStringSchema,
  items: z.array(pluginSummarySchema),
  enable_warning: z.object({
    enabled: z.boolean(),
    require_acknowledgement: z.boolean(),
    reminder_text: nonEmptyStringSchema,
    reminder_text_hash: nonEmptyStringSchema
  })
})

export const pluginOperationAcknowledgementSchema = z.object({
  acknowledged: z.literal(true),
  pack_id: nonEmptyStringSchema,
  installation: pluginSummarySchema
})

export const activePackPluginRuntimeDataSchema = z.object({
  pack_id: nonEmptyStringSchema,
  plugins: z.array(pluginWebManifestItemSchema)
})

export const pluginRuntimeWarningConfigSchema = z.object({
  enabled: z.boolean(),
  require_acknowledgement: z.boolean()
})

export type PluginManifest = z.infer<typeof pluginManifestSchema>
export type PluginArtifact = z.infer<typeof pluginArtifactSchema>
export type PluginInstallation = z.infer<typeof pluginInstallationSchema>
export type PluginActivationSession = z.infer<typeof pluginActivationSessionSchema>
export type PluginEnableAcknowledgement = z.infer<typeof pluginEnableAcknowledgementSchema>
export type PluginAuditEventCode = z.infer<typeof pluginAuditEventCodeSchema>
export type PluginListResponseData = z.infer<typeof pluginListResponseDataSchema>
