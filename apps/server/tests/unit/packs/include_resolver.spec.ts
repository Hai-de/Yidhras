import fs from 'node:fs';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { resolveIncludes } from '../../../src/packs/manifest/include_resolver.js';

const TMP_DIR = path.resolve('/tmp/yidhras-include-resolver-test');

beforeEach(() => {
  fs.mkdirSync(TMP_DIR, { recursive: true });
});

afterEach(() => {
  fs.rmSync(TMP_DIR, { recursive: true, force: true });
});

function writeFile(relativePath: string, content: string): string {
  const fullPath = path.join(TMP_DIR, relativePath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, content, 'utf-8');
  return fullPath;
}

describe('resolveIncludes', () => {
  describe('no include directive', () => {
    it('returns original object unchanged when include field is absent', () => {
      const entry = { metadata: { id: 'test', name: 'Test', version: '1.0.0' } };
      const { merged, diagnostics } = resolveIncludes(entry, TMP_DIR);

      expect(merged).toEqual({ metadata: { id: 'test', name: 'Test', version: '1.0.0' } });
      expect(diagnostics).toEqual([]);
    });

    it('returns original object unchanged when include is null', () => {
      const entry = { metadata: { id: 'test', name: 'Test', version: '1.0.0' }, include: null };
      const { merged, diagnostics } = resolveIncludes(entry as unknown as Record<string, unknown>, TMP_DIR);

      expect(merged.metadata).toEqual({ id: 'test', name: 'Test', version: '1.0.0' });
      expect(diagnostics).toEqual([]);
    });

    it('returns original object unchanged when include is empty object', () => {
      const entry = { metadata: { id: 'test', name: 'Test', version: '1.0.0' }, include: {} };
      const { merged, diagnostics } = resolveIncludes(entry, TMP_DIR);

      expect(merged.metadata).toEqual({ id: 'test', name: 'Test', version: '1.0.0' });
      expect(diagnostics).toEqual([]);
    });
  });

  describe('basic resolution', () => {
    it('loads and merges a single included file', () => {
      writeFile('config/variables.yaml', 'foo: bar\nbaz: 42');
      const entry = {
        metadata: { id: 'test', name: 'Test', version: '1.0.0' },
        include: { variables: 'config/variables.yaml' }
      };

      const { merged, diagnostics } = resolveIncludes(entry, TMP_DIR);

      expect(merged.variables).toEqual({ foo: 'bar', baz: 42 });
      expect(merged.metadata).toEqual({ id: 'test', name: 'Test', version: '1.0.0' });
      expect('include' in merged).toBe(false);
      expect(diagnostics.filter((d) => d.severity === 'ERROR')).toEqual([]);
    });

    it('loads and merges multiple included files', () => {
      writeFile('config/variables.yaml', 'theme: mystery');
      writeFile('config/prompts.yaml', 'global: "hello world"');
      const entry = {
        metadata: { id: 'test', name: 'Test', version: '1.0.0' },
        include: {
          variables: 'config/variables.yaml',
          prompts: 'config/prompts.yaml'
        }
      };

      const { merged, diagnostics } = resolveIncludes(entry, TMP_DIR);

      expect(merged.variables).toEqual({ theme: 'mystery' });
      expect(merged.prompts).toEqual({ global: 'hello world' });
      expect(diagnostics.filter((d) => d.severity === 'ERROR')).toEqual([]);
    });

    it('resolves include paths relative to pack directory', () => {
      writeFile('sub/deep/vars.yaml', 'deep: true');
      const entry = {
        metadata: { id: 'test', name: 'Test', version: '1.0.0' },
        include: { variables: 'sub/deep/vars.yaml' }
      };

      const { merged } = resolveIncludes(entry, TMP_DIR);

      expect(merged.variables).toEqual({ deep: true });
    });
  });

  describe('top-level YAML arrays', () => {
    it('handles YAML files with top-level arrays (identities)', () => {
      writeFile('config/identities.yaml', '- id: "a"\n  type: "agent"\n- id: "b"\n  type: "agent"');
      const entry = {
        metadata: { id: 'test', name: 'Test', version: '1.0.0' },
        include: { identities: 'config/identities.yaml' }
      };

      const { merged, diagnostics } = resolveIncludes(entry, TMP_DIR);

      expect(Array.isArray(merged.identities)).toBe(true);
      expect((merged.identities as unknown[]).length).toBe(2);
      expect(diagnostics.filter((d) => d.severity === 'ERROR')).toEqual([]);
    });

    it('handles YAML files with top-level arrays (capabilities)', () => {
      writeFile('config/capabilities.yaml', '- key: "invoke.foo"\n  category: "invoke"');
      const entry = {
        metadata: { id: 'test', name: 'Test', version: '1.0.0' },
        include: { capabilities: 'config/capabilities.yaml' }
      };

      const { merged, diagnostics } = resolveIncludes(entry, TMP_DIR);

      expect(Array.isArray(merged.capabilities)).toBe(true);
      expect(diagnostics.filter((d) => d.severity === 'ERROR')).toEqual([]);
    });
  });

  describe('auto-unwrap for single-key files', () => {
    it('unwraps when file has exactly one key matching the section name', () => {
      writeFile('config/variables.yaml', 'variables:\n  x: 1\n  y: 2');
      const entry = {
        metadata: { id: 'test', name: 'Test', version: '1.0.0' },
        include: { variables: 'config/variables.yaml' }
      };

      const { merged, diagnostics } = resolveIncludes(entry, TMP_DIR);

      expect(merged.variables).toEqual({ x: 1, y: 2 });
      expect(diagnostics.filter((d) => d.severity === 'ERROR')).toEqual([]);
    });

    it('does not unwrap when file has multiple keys', () => {
      writeFile('config/time.yaml', 'time_systems:\n  - id: clock\nsimulation_time:\n  step_ticks: 10');
      const entry = {
        metadata: { id: 'test', name: 'Test', version: '1.0.0' },
        include: { time_systems: 'config/time.yaml' }
      };

      const { merged } = resolveIncludes(entry, TMP_DIR);

      expect(merged.time_systems).toEqual({
        time_systems: [{ id: 'clock' }],
        simulation_time: { step_ticks: 10 }
      });
    });
  });

  describe('unknown section keys', () => {
    it('produces WARN but still includes the section', () => {
      writeFile('config/extra.yaml', 'custom: data');
      const entry = {
        metadata: { id: 'test', name: 'Test', version: '1.0.0' },
        include: { custom_section: 'config/extra.yaml' }
      };

      const { merged, diagnostics } = resolveIncludes(entry, TMP_DIR);

      expect(merged.custom_section).toEqual({ custom: 'data' });
      expect(diagnostics.filter((d) => d.severity === 'WARN')).toHaveLength(1);
      expect(diagnostics[0].section).toBe('custom_section');
      expect(diagnostics[0].message).toContain('Unknown section key');
    });
  });

  describe('error handling', () => {
    it('ERROR when included file does not exist', () => {
      const entry = {
        metadata: { id: 'test', name: 'Test', version: '1.0.0' },
        include: { variables: 'config/nonexistent.yaml' }
      };

      const { diagnostics } = resolveIncludes(entry, TMP_DIR);

      const errors = diagnostics.filter((d) => d.severity === 'ERROR');
      expect(errors).toHaveLength(1);
      expect(errors[0].message).toContain('File not found');
      expect(errors[0].section).toBe('variables');
    });

    it('ERROR when included file has invalid YAML', () => {
      writeFile('config/bad.yaml', '{invalid: yaml: [');
      const entry = {
        metadata: { id: 'test', name: 'Test', version: '1.0.0' },
        include: { variables: 'config/bad.yaml' }
      };

      const { diagnostics } = resolveIncludes(entry, TMP_DIR);

      const errors = diagnostics.filter((d) => d.severity === 'ERROR');
      expect(errors).toHaveLength(1);
      expect(errors[0].message).toContain('YAML parse error');
    });

    it('ERROR on path traversal attempt', () => {
      const entry = {
        metadata: { id: 'test', name: 'Test', version: '1.0.0' },
        include: { variables: '../../etc/passwd' }
      };

      const { diagnostics } = resolveIncludes(entry, TMP_DIR);

      const errors = diagnostics.filter((d) => d.severity === 'ERROR');
      expect(errors).toHaveLength(1);
      expect(errors[0].message).toContain('Path traversal rejected');
    });

    it('ERROR when file parses to null', () => {
      writeFile('config/null.yaml', 'null');
      const entry = {
        metadata: { id: 'test', name: 'Test', version: '1.0.0' },
        include: { variables: 'config/null.yaml' }
      };

      const { diagnostics } = resolveIncludes(entry, TMP_DIR);

      const errors = diagnostics.filter((d) => d.severity === 'ERROR');
      expect(errors).toHaveLength(1);
      expect(errors[0].message).toContain('null');
    });
  });

  describe('conflict handling', () => {
    it('WARNs when section is defined both inline and via include, include wins', () => {
      writeFile('config/variables.yaml', 'from_file: true');
      const entry = {
        metadata: { id: 'test', name: 'Test', version: '1.0.0' },
        variables: { from_entry: true },
        include: { variables: 'config/variables.yaml' }
      };

      const { merged, diagnostics } = resolveIncludes(entry, TMP_DIR);

      expect(merged.variables).toEqual({ from_file: true });
      const warns = diagnostics.filter((d) => d.severity === 'WARN');
      expect(warns.some((w) => w.message.includes('defined both inline'))).toBe(true);
    });

    it('does not consider "include" key itself as a conflict', () => {
      writeFile('config/variables.yaml', 'foo: bar');
      const entry = {
        metadata: { id: 'test', name: 'Test', version: '1.0.0' },
        include: { variables: 'config/variables.yaml' }
      };

      const { diagnostics } = resolveIncludes(entry, TMP_DIR);
      const conflicts = diagnostics.filter(
        (d) => d.severity === 'WARN' && d.message.includes('defined both inline')
      );
      expect(conflicts).toEqual([]);
    });
  });

  describe('deduplication', () => {
    it('does not re-read the same file when referenced by multiple sections', () => {
      writeFile('config/shared.yaml', 'shared: true');
      const entry = {
        metadata: { id: 'test', name: 'Test', version: '1.0.0' },
        include: {
          variables: 'config/shared.yaml',
          prompts: 'config/shared.yaml'
        }
      };

      const { merged, diagnostics } = resolveIncludes(entry, TMP_DIR);

      expect(merged.variables).toEqual({ shared: true });
      expect(merged.prompts).toEqual({ shared: true });
      expect(diagnostics.filter((d) => d.severity === 'ERROR')).toEqual([]);
    });
  });

  describe('merged object cleanliness', () => {
    it('remove include field from merged result', () => {
      writeFile('config/variables.yaml', 'foo: bar');
      const entry = {
        metadata: { id: 'test', name: 'Test', version: '1.0.0' },
        include: { variables: 'config/variables.yaml' }
      };

      const { merged } = resolveIncludes(entry, TMP_DIR);

      expect('include' in merged).toBe(false);
      expect(merged.metadata).toBeDefined();
    });

    it('preserves metadata and other non-included sections', () => {
      writeFile('config/variables.yaml', 'theme: mystery');
      const entry = {
        metadata: { id: 'test', name: 'Test', version: '1.0.0' },
        prompts: { global_prefix: 'hello' },
        include: { variables: 'config/variables.yaml' }
      };

      const { merged } = resolveIncludes(entry, TMP_DIR);

      expect(merged.metadata).toEqual({ id: 'test', name: 'Test', version: '1.0.0' });
      expect(merged.prompts).toEqual({ global_prefix: 'hello' });
      expect(merged.variables).toEqual({ theme: 'mystery' });
    });
  });
});
