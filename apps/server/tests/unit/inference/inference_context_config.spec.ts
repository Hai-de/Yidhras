import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  InferenceContextConfigLoader,
  inferenceContextConfigSchema,
  resolveConfigValues
} from '../../../src/inference/context/config_loader.js';

const createdRoots: string[] = [];

const writeWorkspaceFile = async (rootDir: string, relativePath: string, content: string): Promise<void> => {
  const targetPath = path.join(rootDir, relativePath);
  await mkdir(path.dirname(targetPath), { recursive: true });
  await writeFile(targetPath, content, 'utf-8');
};

const createWorkspace = async (files: Record<string, string>): Promise<string> => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), 'yidhras-icc-'));
  createdRoots.push(rootDir);

  await writeWorkspaceFile(rootDir, 'pnpm-workspace.yaml', 'packages: []\n');

  for (const [relativePath, content] of Object.entries(files)) {
    await writeWorkspaceFile(rootDir, relativePath, content);
  }

  return rootDir;
};

afterEach(async () => {
  delete process.env.WORKSPACE_ROOT;
  delete process.env.ICC_SNR_FALLBACK;
  delete process.env.ICC_FRAGILE_SNR;
  delete process.env.ICC_FRAGILE_DROP_CHANCE;
  delete process.env.ICC_BEST_EFFORT_DROP_CHANCE;
  delete process.env.ICC_RELIABLE_DROP_CHANCE;

  const { rm } = await import('node:fs/promises');
  for (const root of createdRoots.splice(0, createdRoots.length)) {
    await rm(root, { force: true, recursive: true });
  }
});

describe('InferenceContextConfigLoader', () => {
  it('loads builtin defaults when no config file exists', async () => {
    const rootDir = await createWorkspace({});
    process.env.WORKSPACE_ROOT = rootDir;

    const loader = new InferenceContextConfigLoader();
    const config = loader.getConfig();

    expect(config.config_version).toBe(1);
    expect(config.variable_context?.layers?.system?.enabled).toBe(true);
    expect(config.variable_context?.layers?.actor?.values?.identity_id).toBe('{{actor.identity.id}}');
    expect(config.transmission_profile?.defaults?.snr_fallback).toBe(0.5);
    expect(config.transmission_profile?.thresholds?.fragile_snr).toBe(0.3);
    expect(config.transmission_profile?.drop_chances?.fragile).toBe(0.35);
    expect(config.transmission_profile?.drop_chances?.best_effort).toBe(0.15);
    expect(config.transmission_profile?.drop_chances?.reliable).toBe(0.0);
    expect(config.policy_summary?.evaluations).toHaveLength(2);
  });

  it('loads YAML file override when present', async () => {
    const rootDir = await createWorkspace({
      'data/configw/inference_context.yaml': [
        'config_version: 1',
        'transmission_profile:',
        '  defaults:',
        '    snr_fallback: 0.8',
        '  thresholds:',
        '    fragile_snr: 0.2',
        '  drop_chances:',
        '    fragile: 0.5',
        '    best_effort: 0.2',
        '    reliable: 0.05',
        'policy_summary:',
        '  evaluations:',
        '    - resource: custom_resource',
        '      action: custom_action',
        '      fields:',
        '        - field_a',
        '        - field_b'
      ].join('\n') + '\n'
    });

    process.env.WORKSPACE_ROOT = rootDir;

    const loader = new InferenceContextConfigLoader();
    const config = loader.getConfig();

    expect(config.transmission_profile?.defaults?.snr_fallback).toBe(0.8);
    expect(config.transmission_profile?.thresholds?.fragile_snr).toBe(0.2);
    expect(config.transmission_profile?.drop_chances?.fragile).toBe(0.5);
    expect(config.transmission_profile?.drop_chances?.best_effort).toBe(0.2);
    expect(config.transmission_profile?.drop_chances?.reliable).toBe(0.05);
    expect(config.policy_summary?.evaluations).toHaveLength(1);
    expect(config.policy_summary?.evaluations?.[0]).toMatchObject({
      resource: 'custom_resource',
      action: 'custom_action',
      fields: ['field_a', 'field_b']
    });
  });

  it('allows env to override YAML values', async () => {
    const rootDir = await createWorkspace({
      'data/configw/inference_context.yaml': [
        'config_version: 1',
        'transmission_profile:',
        '  defaults:',
        '    snr_fallback: 0.8'
      ].join('\n') + '\n'
    });

    process.env.WORKSPACE_ROOT = rootDir;
    process.env.ICC_SNR_FALLBACK = '0.95';
    process.env.ICC_FRAGILE_SNR = '0.15';
    process.env.ICC_FRAGILE_DROP_CHANCE = '0.6';
    process.env.ICC_BEST_EFFORT_DROP_CHANCE = '0.25';
    process.env.ICC_RELIABLE_DROP_CHANCE = '0.1';

    const loader = new InferenceContextConfigLoader();
    const config = loader.getConfig();

    expect(config.transmission_profile?.defaults?.snr_fallback).toBe(0.95);
    expect(config.transmission_profile?.thresholds?.fragile_snr).toBe(0.15);
    expect(config.transmission_profile?.drop_chances?.fragile).toBe(0.6);
    expect(config.transmission_profile?.drop_chances?.best_effort).toBe(0.25);
    expect(config.transmission_profile?.drop_chances?.reliable).toBe(0.1);
  });

  it('caches global config on repeated calls', async () => {
    const rootDir = await createWorkspace({
      'data/configw/inference_context.yaml': [
        'config_version: 1',
        'transmission_profile:',
        '  defaults:',
        '    snr_fallback: 0.7'
      ].join('\n') + '\n'
    });

    process.env.WORKSPACE_ROOT = rootDir;

    const loader = new InferenceContextConfigLoader();
    const config1 = loader.getConfig();
    const config2 = loader.getConfig();

    // Same instance returns same cached config
    expect(config1.transmission_profile?.defaults?.snr_fallback).toBe(0.7);
    expect(config2.transmission_profile?.defaults?.snr_fallback).toBe(0.7);

    // resetCache clears and reloads
    loader.resetCache();
    const config3 = loader.getConfig();
    expect(config3.transmission_profile?.defaults?.snr_fallback).toBe(0.7);
  });

  it('rejects invalid config_version via schema validation', () => {
    const invalid = { config_version: -1 };
    const result = inferenceContextConfigSchema.safeParse(invalid);
    expect(result.success).toBe(false);
  });

  it('rejects unknown fields via strict schema', () => {
    const invalid = {
      config_version: 1,
      unknown_field: 'should_fail'
    };
    const result = inferenceContextConfigSchema.safeParse(invalid);
    expect(result.success).toBe(false);
  });
});

describe('resolveConfigValues', () => {
  it('resolves simple literal values', () => {
    const result = resolveConfigValues({ name: 'Yidhras', count: 42 }, {});
    expect(result).toEqual({ name: 'Yidhras', count: 42 });
  });

  it('resolves template expressions from runtime objects', () => {
    const result = resolveConfigValues(
      { display_name: '{{actor.display_name}}' },
      { actor: { display_name: 'TestActor' } }
    );
    expect(result).toEqual({ display_name: 'TestActor' });
  });

  it('resolves template expressions with fallback', () => {
    const result = resolveConfigValues(
      { actor_id: '{{actor.agent_id ?? actor.identity.id}}' },
      { actor: { identity: { id: 'fallback-id' } } }
    );
    expect(result).toEqual({ actor_id: 'fallback-id' });
  });

  it('resolves nested path templates', () => {
    const result = resolveConfigValues(
      { level: '{{app.startup_health.level}}' },
      { app: { startup_health: { level: 'healthy' } } }
    );
    expect(result).toEqual({ level: 'healthy' });
  });

  it('returns null for unresolved templates without fallback', () => {
    const result = resolveConfigValues(
      { missing: '{{nonexistent.path}}' },
      {}
    );
    expect(result).toEqual({ missing: null });
  });

  it('resolves object values recursively', () => {
    const result = resolveConfigValues(
      {
        nested: {
          name: '{{actor.name}}',
          static: 'value'
        }
      },
      { actor: { name: 'NestedActor' } }
    );
    expect(result).toEqual({ nested: { name: 'NestedActor', static: 'value' } });
  });

  it('resolves array values', () => {
    const result = resolveConfigValues(
      {
        items: ['{{actor.name}}', 'static']
      },
      { actor: { name: 'ArrayActor' } }
    );
    expect(result).toEqual({ items: ['ArrayActor', 'static'] });
  });
});
