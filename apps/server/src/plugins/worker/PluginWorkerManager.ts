import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import type { PluginInstallation, PluginManifest } from '@yidhras/contracts';

import type { AppContext } from '../../app/context.js';
import { PLUGIN_CAPABILITY_KEY } from '../capability_keys.js';
import {
  recordPluginWorkerActivationCompleted,
  setPluginWorkersActive
} from '../../observability/metrics.js';
import { createLogger } from '../../utils/logger.js';
import type { ContributionDescriptor, ContributionType } from './contribution_descriptors.js';
import { PluginWorkerClient } from './PluginWorkerClient.js';
import type { PluginWorkerActivationInput } from './protocol.js';

const logger = createLogger('plugin-worker-manager');

export interface PluginWorkerActivationTarget {
  installation: PluginInstallation;
  manifest: PluginManifest;
  artifactRoot: string;
  entrypointPath: string;
  packId: string;
  hostApiVersion: string;
}

export interface ActivatedPluginWorker {
  client: PluginWorkerClient;
  descriptors: ContributionDescriptor[];
  loadedServer: boolean;
  threadId: number;
}

const workerKey = (packId: string, installationId: string): string => `${packId}:${installationId}`;

const descriptorCapabilityDefaults: Record<ContributionType, string> = {
  context_source: PLUGIN_CAPABILITY_KEY.CONTEXT_SOURCE_REGISTER,
  prompt_workflow_step: PLUGIN_CAPABILITY_KEY.PROMPT_WORKFLOW_REGISTER,
  api_route: PLUGIN_CAPABILITY_KEY.API_ROUTE_REGISTER,
  step_contributor: PLUGIN_CAPABILITY_KEY.STEP_CONTRIBUTOR_REGISTER,
  rule_contributor: PLUGIN_CAPABILITY_KEY.RULE_CONTRIBUTOR_REGISTER,
  query_contributor: PLUGIN_CAPABILITY_KEY.QUERY_CONTRIBUTOR_REGISTER,
  data_cleaner: PLUGIN_CAPABILITY_KEY.DATA_CLEANER_REGISTER,
  slot_condition_evaluator: PLUGIN_CAPABILITY_KEY.SLOT_CONDITION_REGISTER,
  slot_content_transformer: PLUGIN_CAPABILITY_KEY.SLOT_CONTENT_TRANSFORM_REGISTER,
  perception_resolver: PLUGIN_CAPABILITY_KEY.PERCEPTION_RESOLVER_REGISTER
};

const descriptorKey = (type: ContributionType, invoke: string): string => `${type}:${invoke}`;

const manifestDescriptorKeys = (manifest: PluginManifest): Set<string> => {
  const keys = new Set<string>();
  const server = manifest.contributions.server;

  for (const item of server.context_sources) {
    keys.add(descriptorKey('context_source', item.invoke));
  }
  for (const item of server.prompt_workflow_steps) {
    keys.add(descriptorKey('prompt_workflow_step', item.invoke));
  }
  for (const item of server.api_routes) {
    keys.add(descriptorKey('api_route', item.invoke));
  }
  for (const item of server.step_contributors) {
    keys.add(descriptorKey('step_contributor', item.invoke));
  }
  for (const item of server.rule_contributors) {
    keys.add(descriptorKey('rule_contributor', item.invoke));
  }
  for (const item of server.query_contributors) {
    keys.add(descriptorKey('query_contributor', item.invoke));
  }
  for (const item of server.data_cleaners) {
    keys.add(descriptorKey('data_cleaner', item.invoke));
  }
  for (const item of server.slot_condition_evaluators) {
    keys.add(descriptorKey('slot_condition_evaluator', item.invoke));
  }
  for (const item of server.slot_content_transformers) {
    keys.add(descriptorKey('slot_content_transformer', item.invoke));
  }
  for (const item of server.perception_resolvers) {
    keys.add(descriptorKey('perception_resolver', item.invoke));
  }

  return keys;
};

const assertDescriptorCapabilities = (
  descriptors: ContributionDescriptor[],
  grantedCapabilities: string[]
): void => {
  for (const descriptor of descriptors) {
    const required = descriptor.capabilityKey ?? descriptorCapabilityDefaults[descriptor.type];
    if (!grantedCapabilities.includes(required)) {
      throw new Error(
        `Plugin descriptor ${descriptor.type}:${descriptor.invoke} requires ungranted capability: ${required}`
      );
    }
  }
};

const assertManifestDescriptorAlignment = (
  manifest: PluginManifest,
  descriptors: ContributionDescriptor[]
): void => {
  const manifestKeys = manifestDescriptorKeys(manifest);
  const descriptorKeys = new Set(descriptors.map(descriptor => descriptorKey(descriptor.type, descriptor.invoke)));

  const missingDescriptors = [...manifestKeys].filter(key => !descriptorKeys.has(key));
  if (missingDescriptors.length > 0) {
    throw new Error(`Plugin manifest contributions missing worker descriptors: ${missingDescriptors.join(', ')}`);
  }

  const undeclaredDescriptors = [...descriptorKeys].filter(key => !manifestKeys.has(key));
  if (undeclaredDescriptors.length > 0) {
    throw new Error(`Plugin worker descriptors missing manifest declarations: ${undeclaredDescriptors.join(', ')}`);
  }
};

const persistInstallationError = async (
  context: AppContext,
  installation: PluginInstallation,
  message: string | undefined
): Promise<void> => {
  await context.repos.plugin.upsertInstallation({
    installation_id: installation.installation_id,
    plugin_id: installation.plugin_id,
    artifact_id: installation.artifact_id,
    version: installation.version,
    scope_type: installation.scope_type,
    scope_ref: installation.scope_ref,
    lifecycle_state: installation.lifecycle_state,
    requested_capabilities: installation.requested_capabilities,
    granted_capabilities: installation.granted_capabilities,
    trust_mode: installation.trust_mode,
    confirmed_at: installation.confirmed_at,
    enabled_at: installation.enabled_at,
    disabled_at: installation.disabled_at,
    last_error: message
  });
};

export class PluginWorkerManager {
  private readonly workers = new Map<string, PluginWorkerClient>();

  public async activateInstallation(
    context: AppContext,
    target: PluginWorkerActivationTarget
  ): Promise<ActivatedPluginWorker> {
    const activationId = randomUUID();
    const startedAt = String(Date.now());

    await context.repos.plugin.createActivationSession({
      activation_id: activationId,
      installation_id: target.installation.installation_id,
      pack_id: target.packId,
      channel: 'startup_restore',
      result: 'failed',
      started_at: startedAt,
      loaded_server: false,
      loaded_web_manifest: Boolean(target.manifest.entrypoints.web)
    });

    const client = new PluginWorkerClient({
      context,
      packId: target.packId,
      pluginId: target.installation.plugin_id,
      installationId: target.installation.installation_id,
      grantedCapabilities: target.installation.granted_capabilities,
      onCrash: error => {
        this.workers.delete(workerKey(target.packId, target.installation.installation_id));
        logger.error('Plugin worker crashed after activation', {
          pack_id: target.packId,
          plugin_id: target.installation.plugin_id,
          installation_id: target.installation.installation_id,
          error: error.message
        });
        this.updateActiveWorkerMetric(target.packId);
      }
    });

    try {
      const activationStartedAt = Date.now();
      const activationInput: PluginWorkerActivationInput = {
        hostApiVersion: target.hostApiVersion,
        manifest: target.manifest,
        installation: target.installation,
        artifactRoot: target.artifactRoot,
        entrypointPath: pathToFileURL(target.entrypointPath).href,
        packId: target.packId,
        grantedCapabilities: target.installation.granted_capabilities
      };

      const snapshot = await client.activate(activationInput);
      assertDescriptorCapabilities(snapshot.descriptors, target.installation.granted_capabilities);
      assertManifestDescriptorAlignment(target.manifest, snapshot.descriptors);
      recordPluginWorkerActivationCompleted(
        target.packId,
        target.installation.plugin_id,
        target.installation.installation_id,
        Date.now() - activationStartedAt,
        'success'
      );

      await context.repos.plugin.updateActivationSession(activationId, {
        result: 'success',
        finished_at: String(Date.now()),
        loaded_server: snapshot.loadedServer,
        loaded_web_manifest: Boolean(target.manifest.entrypoints.web),
        error_message: undefined
      });
      await persistInstallationError(context, target.installation, undefined);

      return {
        client,
        descriptors: snapshot.descriptors,
        loadedServer: snapshot.loadedServer,
        threadId: snapshot.threadId
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      recordPluginWorkerActivationCompleted(
        target.packId,
        target.installation.plugin_id,
        target.installation.installation_id,
        Date.now() - Number(startedAt),
        'failed'
      );
      await client.terminate(`activation failed: ${message}`).catch(() => {});
      await context.repos.plugin.updateActivationSession(activationId, {
        result: 'failed',
        finished_at: String(Date.now()),
        loaded_server: false,
        loaded_web_manifest: Boolean(target.manifest.entrypoints.web),
        error_message: message
      }).catch(() => {});
      await persistInstallationError(context, target.installation, message).catch(() => {});
      throw error;
    }
  }

  public async replacePackWorkers(packId: string, nextClients: PluginWorkerClient[]): Promise<void> {
    const next = new Set(nextClients);
    const removals: Array<Promise<void>> = [];

    for (const [key, client] of this.workers.entries()) {
      if (!key.startsWith(`${packId}:`) || next.has(client)) {
        continue;
      }
      this.workers.delete(key);
      removals.push(client.deactivate().catch(() => undefined).then(() => client.terminate('replaced')));
    }

    for (const client of nextClients) {
      this.workers.set(workerKey(packId, client.installationId), client);
    }

    await Promise.all(removals);
    this.updateActiveWorkerMetric(packId);
  }

  public async deactivateInstallation(packId: string, installationId: string): Promise<void> {
    const key = workerKey(packId, installationId);
    const client = this.workers.get(key);
    if (!client) {
      return;
    }
    this.workers.delete(key);
    await client.deactivate().catch(() => undefined);
    await client.terminate('deactivated');
    this.updateActiveWorkerMetric(packId);
  }

  public getWorker(packId: string, installationId: string): PluginWorkerClient | undefined {
    return this.workers.get(workerKey(packId, installationId));
  }

  private updateActiveWorkerMetric(packId: string): void {
    let activeCount = 0;
    for (const [key, client] of this.workers.entries()) {
      if (key.startsWith(`${packId}:`) && client.isAlive()) {
        activeCount += 1;
      }
    }
    setPluginWorkersActive(packId, activeCount);
  }
}

export const pluginWorkerManager = new PluginWorkerManager();

export const resolvePluginEntrypointPath = (input: {
  artifactRoot: string;
  source: string;
}): string => {
  return path.resolve(input.artifactRoot, input.source);
};
