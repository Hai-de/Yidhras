import { describe, expect, it } from 'vitest';

import { TreeRegistry } from '../../src/inference/providers/behavior_tree/tree_registry.js';
import { expectArrayElement, expectDefined } from '../helpers/assertions.js';

describe('TreeRegistry', () => {
  it('registers and retrieves a simple tree without $ref', () => {
    const registry = new TreeRegistry('pack-1');
    registry.register({
      simple_tree: {
        type: 'selector',
        children: [
          { type: 'condition', condition: { state: 'x', eq: true } },
          { type: 'action', action: { kernel: 'noop' } }
        ]
      }
    });
    const tree = registry.get('simple_tree');
    expect(tree).toBeDefined();
    expect(tree.name).toBe('simple_tree');
    expect(tree.sourcePackId).toBe('pack-1');
    expect(tree.root.type).toBe('selector');
    expect(tree.root.children).toHaveLength(2);
  });

  it('resolves $ref within the same pack', () => {
    const registry = new TreeRegistry('pack-1');
    registry.register({
      '_common/ensure_ready': {
        type: 'selector',
        children: [
          { type: 'condition', condition: { state: 'ready', eq: true } }
        ]
      },
      main_tree: {
        type: 'sequence',
        children: [
          { $ref: '_common/ensure_ready' },
          { type: 'action', action: { kernel: 'noop' } }
        ]
      }
    });
    const tree = registry.get('main_tree');
    expect(tree.root.children).toHaveLength(2);
    // First child should be expanded from $ref
    const firstChild = expectArrayElement(expectDefined(tree.root.children, 'root children'), 0, 'root children');
    expect(firstChild.$ref).toBeUndefined();
    expect(firstChild.type).toBe('selector');
    expect(firstChild.children).toHaveLength(1);
  });

  it('resolves multi-level $ref (A → B → C)', () => {
    const registry = new TreeRegistry('pack-1');
    registry.register({
      c: { type: 'action', action: { kernel: 'c_action' } },
      b: {
        type: 'sequence',
        children: [{ $ref: 'c' }]
      },
      a: {
        type: 'selector',
        children: [{ $ref: 'b' }]
      }
    });
    const tree = registry.get('a');
    const firstChild = expectArrayElement(expectDefined(tree.root.children, 'root children'), 0, 'root children');
    expect(firstChild.type).toBe('sequence');
    const innerChild = expectArrayElement(expectDefined(firstChild.children, 'first child children'), 0, 'first child children');
    expect(innerChild.type).toBe('action');
  });

  it('throws when $ref target does not exist', () => {
    const registry = new TreeRegistry('pack-1');
    registry.register({
      main: {
        type: 'selector',
        children: [{ $ref: 'nonexistent' }]
      }
    });
    expect(() => registry.get('main')).toThrow(/nonexistent/);
  });

  it('detects and throws on $ref cycle (A → B → A)', () => {
    const registry = new TreeRegistry('pack-1');
    registry.register({
      a: {
        type: 'selector',
        children: [{ $ref: 'b' }]
      },
      b: {
        type: 'selector',
        children: [{ $ref: 'a' }]
      }
    });
    expect(() => registry.get('a')).toThrow(/cycle|circular/i);
  });

  it('detects and throws on $ref self-reference (A → A)', () => {
    const registry = new TreeRegistry('pack-1');
    registry.register({
      a: {
        type: 'selector',
        children: [{ $ref: 'a' }]
      }
    });
    expect(() => registry.get('a')).toThrow(/self/);
  });

  it('allows depth exactly at limit (16)', () => {
    const registry = new TreeRegistry('pack-1');
    const trees: Record<string, Record<string, unknown>> = {};
    // Build chain: d0 → d1 → d2 → ... → d16 (16 $ref edges, depth 16 in chain)
    trees['d16'] = { type: 'action', action: { kernel: 'deep' } };
    for (let i = 15; i >= 0; i--) {
      trees[`d${i}`] = {
        type: 'selector',
        children: [{ $ref: `d${i + 1}` }]
      };
    }
    registry.register(trees);
    const tree = registry.get('d0');
    expect(tree).toBeDefined();
  });

  it('throws when depth exceeds 16', () => {
    const registry = new TreeRegistry('pack-1');
    const trees: Record<string, Record<string, unknown>> = {};
    // Build chain: d0 → ... → d17 (17 $ref edges)
    trees['d17'] = { type: 'action', action: { kernel: 'too_deep' } };
    for (let i = 16; i >= 0; i--) {
      trees[`d${i}`] = {
        type: 'selector',
        children: [{ $ref: `d${i + 1}` }]
      };
    }
    registry.register(trees);
    expect(() => registry.get('d0')).toThrow(/depth|16/);
  });

  it('accepts empty tree map', () => {
    const registry = new TreeRegistry('pack-1');
    registry.register({});
    expect(registry.list()).toEqual([]);
  });

  it('warns on duplicate tree name registration', () => {
    const registry = new TreeRegistry('pack-1');
    registry.register({ t: { type: 'action', action: { kernel: 'first' } } });
    registry.register({ t: { type: 'action', action: { kernel: 'second' } } });
    // Last registration wins
    const tree = registry.get('t');
    expect(tree).toBeDefined();
  });

  it('rejects Parallel nodes', () => {
    const registry = new TreeRegistry('pack-1');
    expect(() =>
      registry.register({
        bad: { type: 'parallel', children: [] }
      })
    ).toThrow();
  });

  it('rejects Sequence with more than one action leaf', () => {
    const registry = new TreeRegistry('pack-1');
    expect(() =>
      registry.register({
        bad_seq: {
          type: 'sequence',
          children: [
            { type: 'action', action: { kernel: 'first' } },
            { type: 'action', action: { kernel: 'second' } }
          ]
        }
      })
    ).toThrow(/action/);
  });

  it('rejects Sequence with more than one action leaf after decorator unwrapping', () => {
    const registry = new TreeRegistry('pack-1');
    expect(() =>
      registry.register({
        bad_seq: {
          type: 'sequence',
          children: [
            {
              decorators: [{ type: 'cooldown', cooldown_ticks: 3 }],
              child: { type: 'action', action: { kernel: 'first' } }
            },
            { type: 'action', action: { kernel: 'second' } }
          ]
        }
      })
    ).toThrow(/after expanding decorators and \$ref nodes/);
  });

  it('rejects Sequence with more than one action leaf after $ref expansion', () => {
    const registry = new TreeRegistry('pack-1');
    expect(() =>
      registry.register({
        reusable_action: { type: 'action', action: { kernel: 'first' } },
        bad_seq: {
          type: 'sequence',
          children: [
            { $ref: 'reusable_action' },
            { type: 'action', action: { kernel: 'second' } }
          ]
        }
      })
    ).toThrow(/after expanding decorators and \$ref nodes/);
  });

  it('rolls back newly registered trees when Sequence $ref action validation fails', () => {
    const registry = new TreeRegistry('pack-1');
    registry.register({ existing: { type: 'action', action: { kernel: 'existing' } } });

    expect(() =>
      registry.register({
        reusable_action: { type: 'action', action: { kernel: 'first' } },
        bad_seq: {
          type: 'sequence',
          children: [
            { $ref: 'reusable_action' },
            { type: 'action', action: { kernel: 'second' } }
          ]
        }
      })
    ).toThrow(/after expanding decorators and \$ref nodes/);

    expect(registry.list()).toEqual(['existing']);
  });


  it('rejects llm_decision until AI Gateway wiring exists', () => {
    const registry = new TreeRegistry('pack-1');
    expect(() =>
      registry.register({
        bad_llm: {
          type: 'llm_decision',
          prompt_template: 'Choose an action',
          provider: 'openai_compatible',
          model: 'test-model'
        }
      })
    ).toThrow(/llm_decision/);
  });

  it('rejects invalid tree definition (missing type on root)', () => {
    const registry = new TreeRegistry('pack-1');
    expect(() =>
      registry.register({
        bad: { children: [] }
      })
    ).toThrow();
  });

  it('lists all registered tree names', () => {
    const registry = new TreeRegistry('pack-1');
    registry.register({
      a: { type: 'action', action: { kernel: 'a' } },
      b: { type: 'action', action: { kernel: 'b' } }
    });
    const names = registry.list();
    expect(names).toContain('a');
    expect(names).toContain('b');
    expect(names).toHaveLength(2);
  });
});
