import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { InferenceContextConfigLoader } from '../../../src/inference/context/config_loader.js';

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

describe('InferenceContextConfigLoader — deployment-level', () => {
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

    const loader = new InferenceContextConfigLoader('prod');
    const config = loader.getConfig();

    // Deployment-level override for snr_fallback
    expect(config.transmission_profile?.defaults?.snr_fallback).toBe(0.95);
    // Site-level value inherited (fragile_snr not overridden in deployment)
    expect(config.transmission_profile?.thresholds?.fragile_snr).toBe(0.25);
    // Deployment overrides site-level drop_chances
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

    const loader = new InferenceContextConfigLoader('nonexistent');
    const config = loader.getConfig();

    // Should use site-level value
    expect(config.transmission_profile?.defaults?.snr_fallback).toBe(0.7);
    // Builtin defaults for non-overridden fields
    expect(config.transmission_profile?.thresholds?.fragile_snr).toBe(0.3);
  });

  it('loads builtin defaults when no config files exist', async () => {
    const rootDir = await createWorkspace({});
    process.env.WORKSPACE_ROOT = rootDir;

    const loader = new InferenceContextConfigLoader();
    const config = loader.getConfig();

    expect(config.config_version).toBe(1);
    expect(config.transmission_profile?.defaults?.snr_fallback).toBe(0.5);
    expect(config.variable_context?.layers?.system?.enabled).toBe(true);
  });

  it('caches deployment config on repeated calls', async () => {
    const rootDir = await createWorkspace({
      'data/configw/inference_context.d/a.yaml': [
        'config_version: 1',
        'transmission_profile:',
        '  defaults:',
        '    snr_fallback: 0.9'
      ].join('\n') + '\n'
    });

    process.env.WORKSPACE_ROOT = rootDir;

    const loaderA = new InferenceContextConfigLoader('a');
    const config1 = loaderA.getConfig();
    const config2 = loaderA.getConfig();

    // Same instance returns cached value
    expect(config1.transmission_profile?.defaults?.snr_fallback).toBe(0.9);
    expect(config2.transmission_profile?.defaults?.snr_fallback).toBe(0.9);
  });

  it('isolates caches between different loader instances', async () => {
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

    const loaderA = new InferenceContextConfigLoader('a');
    const loaderB = new InferenceContextConfigLoader('b');

    expect(loaderA.getConfig().transmission_profile?.defaults?.snr_fallback).toBe(0.9);
    expect(loaderB.getConfig().transmission_profile?.defaults?.snr_fallback).toBe(0.1);
  });

  it('resetCache clears deployment cache so next call re-reads file', async () => {
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

    const loaderA = new InferenceContextConfigLoader('a');
    const loaderB = new InferenceContextConfigLoader('b');

    // Load both into their per-instance caches
    loaderA.getConfig();
    loaderB.getConfig();

    // Overwrite 'a' deployment file on disk
    await writeWorkspaceFile(rootDir, 'data/configw/inference_context.d/a.yaml', [
      'config_version: 1',
      'transmission_profile:',
      '  defaults:',
      '    snr_fallback: 0.99'
    ].join('\n') + '\n');

    // Without reset, loaderA still returns cached value
    expect(loaderA.getConfig().transmission_profile?.defaults?.snr_fallback).toBe(0.9);

    // Clear only deployment 'a' cache on loaderA
    loaderA.resetCache('a');

    // After reset, loaderA re-reads from disk
    expect(loaderA.getConfig().transmission_profile?.defaults?.snr_fallback).toBe(0.99);

    // loaderB unaffected — still has its cached value
    expect(loaderB.getConfig().transmission_profile?.defaults?.snr_fallback).toBe(0.1);
  });

  it('resetCache without deploymentId clears all caches on instance', async () => {
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

    const loader = new InferenceContextConfigLoader();
    loader.getConfig();

    const loaderA = new InferenceContextConfigLoader('a');
    loaderA.getConfig();

    // Modify site-level file
    await writeWorkspaceFile(rootDir, 'data/configw/inference_context.yaml', [
      'config_version: 1',
      'transmission_profile:',
      '  defaults:',
      '    snr_fallback: 0.72'
    ].join('\n') + '\n');

    // Clear global cache on the loader
    loader.resetCache();

    const reloadedGlobal = loader.getConfig();
    expect(reloadedGlobal.transmission_profile?.defaults?.snr_fallback).toBe(0.72);

    // loaderA still has its deployment cache (separate instance)
    expect(loaderA.getConfig().transmission_profile?.defaults?.snr_fallback).toBe(0.9);
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

    const loader = new InferenceContextConfigLoader('prod');
    const config = loader.getConfig();

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

    const loader = new InferenceContextConfigLoader();
    const config = loader.getConfig();

    expect(config.transmission_profile?.defaults?.snr_fallback).toBe(0.75);
  });

  it('rejects deployment_id with illegal characters', async () => {
    const rootDir = await createWorkspace({});
    process.env.WORKSPACE_ROOT = rootDir;

    expect(() => new InferenceContextConfigLoader('../../../etc/passwd').getConfig()).toThrow();
    expect(() => new InferenceContextConfigLoader('prod/test').getConfig()).toThrow();
    expect(() => new InferenceContextConfigLoader('has space').getConfig()).toThrow();
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

    const loader = new InferenceContextConfigLoader('Test-Dev_123');
    expect(loader.getConfig().transmission_profile?.defaults?.snr_fallback).toBe(0.6);
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

    const loader = new InferenceContextConfigLoader('custom');
    const config = loader.getConfig();
    expect(config.variable_context?.layers?.system?.values?.name).toBe('CustomDeployment');
  });
});
