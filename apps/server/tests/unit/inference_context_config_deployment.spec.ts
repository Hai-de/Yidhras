import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  getInferenceContextConfig,
  getInferenceContextConfigLoadedFile,
  resetInferenceContextConfigCache
} from '../../src/inference/context_config.js';

const createdRoots: string[] = [];

const writeWorkspaceFile = async (rootDir: string, relativePath: string, content: string): Promise<void> => {
  const targetPath = path.join(rootDir, relativePath);
  await mkdir(path.dirname(targetPath), { recursive: true });
  await writeFile(targetPath, content, 'utf-8');
};

const createWorkspace = async (files: Record<string, string>): Promise<string> => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), 'yidhras-icc-deploy-'));
  createdRoots.push(rootDir);

  await writeWorkspaceFile(rootDir, 'pnpm-workspace.yaml', 'packages: []\n');

  for (const [relativePath, content] of Object.entries(files)) {
    await writeWorkspaceFile(rootDir, relativePath, content);
  }

  return rootDir;
};

afterEach(async () => {
  resetInferenceContextConfigCache();
  delete process.env.WORKSPACE_ROOT;
  delete process.env.YIDHRAS_DEPLOYMENT_ID;
  delete process.env.ICC_SNR_FALLBACK;
  delete process.env.ICC_FRAGILE_SNR;
  delete process.env.ICC_FRAGILE_DROP_CHANCE;
  delete process.env.ICC_BEST_EFFORT_DROP_CHANCE;
  delete process.env.ICC_RELIABLE_DROP_CHANCE;
  delete process.env.ICC_POLICY_STRICT_NAMESPACE;

  const { rm } = await import('node:fs/promises');
  for (const root of createdRoots.splice(0, createdRoots.length)) {
    await rm(root, { force: true, recursive: true });
  }
});

describe('deployment-level inference context config', () => {
  it('loads deployment-level config and merges with site-level', async () => {
    const rootDir = await createWorkspace({
      'data/configw/inference_context.yaml': [
        'config_version: 1',
        'transmission_profile:',
        '  defaults:',
        '    snr_fallback: 0.8',
        '  thresholds:',
        '    fragile_snr: 0.25'
      ].join('\n') + '\n',
      'data/configw/inference_context.d/prod.yaml': [
        'config_version: 1',
        'transmission_profile:',
        '  defaults:',
        '    snr_fallback: 0.95',
        '  drop_chances:',
        '    fragile: 0.5',
        '    best_effort: 0.2'
      ].join('\n') + '\n'
    });

    process.env.WORKSPACE_ROOT = rootDir;

    const config = getInferenceContextConfig('prod');

    // Deployment-level override for snr_fallback
    expect(config.transmission_profile?.defaults?.snr_fallback).toBe(0.95);
    // Site-level value inherited (fragile_snr not overridden in deployment)
    expect(config.transmission_profile?.thresholds?.fragile_snr).toBe(0.25);
    // Site-level drop_chances.fragile was 0.35 (default), but deployment overrides to 0.5
    expect(config.transmission_profile?.drop_chances?.fragile).toBe(0.5);
    expect(config.transmission_profile?.drop_chances?.best_effort).toBe(0.2);
    // Not overridden — remains default 0.0
    expect(config.transmission_profile?.drop_chances?.reliable).toBe(0.0);
  });

  it('falls back to site-level config when deployment file does not exist', async () => {
    const rootDir = await createWorkspace({
      'data/configw/inference_context.yaml': [
        'config_version: 1',
        'transmission_profile:',
        '  defaults:',
        '    snr_fallback: 0.7'
      ].join('\n') + '\n'
    });

    process.env.WORKSPACE_ROOT = rootDir;

    const config = getInferenceContextConfig('nonexistent');

    // Should use site-level value
    expect(config.transmission_profile?.defaults?.snr_fallback).toBe(0.7);
    // Builtin defaults for non-overridden fields
    expect(config.transmission_profile?.thresholds?.fragile_snr).toBe(0.3);
  });

  it('returns builtin defaults when no config files exist and no deployment_id', async () => {
    const rootDir = await createWorkspace({});
    process.env.WORKSPACE_ROOT = rootDir;

    const config = getInferenceContextConfig();

    expect(config.config_version).toBe(1);
    expect(config.transmission_profile?.defaults?.snr_fallback).toBe(0.5);
    expect(config.variable_context?.layers?.system?.enabled).toBe(true);
  });

  it('isolates caches between different deployment_ids', async () => {
    const rootDir = await createWorkspace({
      'data/configw/inference_context.d/a.yaml': [
        'config_version: 1',
        'transmission_profile:',
        '  defaults:',
        '    snr_fallback: 0.9'
      ].join('\n') + '\n',
      'data/configw/inference_context.d/b.yaml': [
        'config_version: 1',
        'transmission_profile:',
        '  defaults:',
        '    snr_fallback: 0.1'
      ].join('\n') + '\n'
    });

    process.env.WORKSPACE_ROOT = rootDir;

    const configA = getInferenceContextConfig('a');
    const configB = getInferenceContextConfig('b');

    expect(configA.transmission_profile?.defaults?.snr_fallback).toBe(0.9);
    expect(configB.transmission_profile?.defaults?.snr_fallback).toBe(0.1);
  });

  it('clears specific deployment cache without affecting others', async () => {
    const rootDir = await createWorkspace({
      'data/configw/inference_context.d/a.yaml': [
        'config_version: 1',
        'transmission_profile:',
        '  defaults:',
        '    snr_fallback: 0.9'
      ].join('\n') + '\n',
      'data/configw/inference_context.d/b.yaml': [
        'config_version: 1',
        'transmission_profile:',
        '  defaults:',
        '    snr_fallback: 0.1'
      ].join('\n') + '\n'
    });

    process.env.WORKSPACE_ROOT = rootDir;

    // Load both into cache
    getInferenceContextConfig('a');
    getInferenceContextConfig('b');

    // Now overwrite the 'a' deployment file on disk
    await writeWorkspaceFile(rootDir, 'data/configw/inference_context.d/a.yaml', [
      'config_version: 1',
      'transmission_profile:',
      '  defaults:',
      '    snr_fallback: 0.99'
    ].join('\n') + '\n');

    // Without reset, cache still gives old value
    const cachedA = getInferenceContextConfig('a');
    expect(cachedA.transmission_profile?.defaults?.snr_fallback).toBe(0.9);

    // Clear only deployment 'a'
    resetInferenceContextConfigCache('a');

    const reloadedA = getInferenceContextConfig('a');
    expect(reloadedA.transmission_profile?.defaults?.snr_fallback).toBe(0.99);

    // Deployment 'b' still has its cached value
    const cachedB = getInferenceContextConfig('b');
    expect(cachedB.transmission_profile?.defaults?.snr_fallback).toBe(0.1);
  });

  it('clears all caches when resetting without deployment_id', async () => {
    const rootDir = await createWorkspace({
      'data/configw/inference_context.yaml': [
        'config_version: 1',
        'transmission_profile:',
        '  defaults:',
        '    snr_fallback: 0.7'
      ].join('\n') + '\n',
      'data/configw/inference_context.d/a.yaml': [
        'config_version: 1',
        'transmission_profile:',
        '  defaults:',
        '    snr_fallback: 0.9'
      ].join('\n') + '\n'
    });

    process.env.WORKSPACE_ROOT = rootDir;

    getInferenceContextConfig();
    getInferenceContextConfig('a');

    // Modify site-level file
    await writeWorkspaceFile(rootDir, 'data/configw/inference_context.yaml', [
      'config_version: 1',
      'transmission_profile:',
      '  defaults:',
      '    snr_fallback: 0.72'
    ].join('\n') + '\n');

    resetInferenceContextConfigCache();

    const reloadedGlobal = getInferenceContextConfig();
    expect(reloadedGlobal.transmission_profile?.defaults?.snr_fallback).toBe(0.72);

    const reloadedA = getInferenceContextConfig('a');
    expect(reloadedA.transmission_profile?.defaults?.snr_fallback).toBe(0.9);
  });

  it('env variables override deployment-level config', async () => {
    const rootDir = await createWorkspace({
      'data/configw/inference_context.yaml': [
        'config_version: 1',
        'transmission_profile:',
        '  defaults:',
        '    snr_fallback: 0.8'
      ].join('\n') + '\n',
      'data/configw/inference_context.d/prod.yaml': [
        'config_version: 1',
        'transmission_profile:',
        '  defaults:',
        '    snr_fallback: 0.95'
      ].join('\n') + '\n'
    });

    process.env.WORKSPACE_ROOT = rootDir;
    process.env.ICC_SNR_FALLBACK = '0.99';

    const config = getInferenceContextConfig('prod');

    // Env should win over deployment-level
    expect(config.transmission_profile?.defaults?.snr_fallback).toBe(0.99);
  });

  it('env variables still override when no deployment_id is given', async () => {
    const rootDir = await createWorkspace({
      'data/configw/inference_context.yaml': [
        'config_version: 1',
        'transmission_profile:',
        '  defaults:',
        '    snr_fallback: 0.8'
      ].join('\n') + '\n'
    });

    process.env.WORKSPACE_ROOT = rootDir;
    process.env.ICC_SNR_FALLBACK = '0.75';

    const config = getInferenceContextConfig();

    expect(config.transmission_profile?.defaults?.snr_fallback).toBe(0.75);
  });

  it('rejects deployment_id with illegal characters', async () => {
    const rootDir = await createWorkspace({});
    process.env.WORKSPACE_ROOT = rootDir;

    expect(() => getInferenceContextConfig('../../../etc/passwd')).toThrow();
    expect(() => getInferenceContextConfig('prod/test')).toThrow();
    expect(() => getInferenceContextConfig('has space')).toThrow();
  });

  it('accepts valid deployment_id characters', async () => {
    const rootDir = await createWorkspace({
      'data/configw/inference_context.d/Test-Dev_123.yaml': [
        'config_version: 1',
        'transmission_profile:',
        '  defaults:',
        '    snr_fallback: 0.6'
      ].join('\n') + '\n'
    });

    process.env.WORKSPACE_ROOT = rootDir;

    const config = getInferenceContextConfig('Test-Dev_123');
    expect(config.transmission_profile?.defaults?.snr_fallback).toBe(0.6);
  });

  it('getInferenceContextConfigLoadedFile returns deployment-level path', async () => {
    const rootDir = await createWorkspace({
      'data/configw/inference_context.d/prod.yaml': [
        'config_version: 1'
      ].join('\n') + '\n'
    });

    process.env.WORKSPACE_ROOT = rootDir;

    getInferenceContextConfig('prod');
    const loadedFile = getInferenceContextConfigLoadedFile('prod');

    expect(loadedFile).toContain('inference_context.d/prod.yaml');
  });

  it('getInferenceContextConfigLoadedFile returns null for deployment without file', async () => {
    const rootDir = await createWorkspace({});
    process.env.WORKSPACE_ROOT = rootDir;

    getInferenceContextConfig('no-file');
    const loadedFile = getInferenceContextConfigLoadedFile('no-file');

    expect(loadedFile).toBeNull();
  });

  it('deployment-level variable_context layers override site-level', async () => {
    const rootDir = await createWorkspace({
      'data/configw/inference_context.yaml': [
        'config_version: 1',
        'variable_context:',
        '  layers:',
        '    system:',
        '      enabled: true',
        '      values:',
        '        name: DefaultSite'
      ].join('\n') + '\n',
      'data/configw/inference_context.d/custom.yaml': [
        'config_version: 1',
        'variable_context:',
        '  layers:',
        '    system:',
        '      enabled: true',
        '      values:',
        '        name: CustomDeployment'
      ].join('\n') + '\n'
    });

    process.env.WORKSPACE_ROOT = rootDir;

    const config = getInferenceContextConfig('custom');
    expect(config.variable_context?.layers?.system?.values?.name).toBe('CustomDeployment');
  });

  it('100% backward compatible without YIDHRAS_DEPLOYMENT_ID', async () => {
    const rootDir = await createWorkspace({});
    process.env.WORKSPACE_ROOT = rootDir;
    // Note: YIDHRAS_DEPLOYMENT_ID is not set — this is the default state
    // The context_config module doesn't read YIDHRAS_DEPLOYMENT_ID;
    // context_builder.ts does. This test verifies the config module API contract.

    const config = getInferenceContextConfig();

    expect(config.config_version).toBe(1);
    expect(config.transmission_profile?.defaults?.snr_fallback).toBe(0.5);
    expect(config.transmission_profile?.thresholds?.fragile_snr).toBe(0.3);
    expect(config.transmission_profile?.drop_chances?.fragile).toBe(0.35);
    expect(config.transmission_profile?.drop_chances?.best_effort).toBe(0.15);
    expect(config.transmission_profile?.drop_chances?.reliable).toBe(0.0);
    expect(config.policy_summary?.evaluations).toHaveLength(2);
  });
});
