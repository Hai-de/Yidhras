import { describe, expect, it } from 'vitest';

import { expandStateJson } from '../../../src/packs/runtime/template_expander.js';
import { tokenize } from '../../../src/template_engine/core/lexer.js';
import { parse } from '../../../src/template_engine/core/parser.js';
import { createPRNG } from '../../../src/template_engine/core/prng.js';
import { renderAst } from '../../../src/template_engine/core/renderer.js';
import type { RenderScope } from '../../../src/template_engine/core/types.js';
import { BUILTIN_MACRO_HANDLERS } from '../../../src/template_engine/defaults.js';

const buildScope = (seed?: string): RenderScope => ({
  variables: {},
  modifiers: {},
  blockHandlers: {},
  macroHandlers: BUILTIN_MACRO_HANDLERS,
  prng: seed ? createPRNG(seed) : undefined,
  depth: 0,
  maxDepth: 32
});

const render = (template: string, scope: RenderScope): string => {
  const tokens = tokenize(template);
  const { nodes } = parse(tokens);
  return renderAst(nodes, scope);
};

describe('PRNG', () => {
  it('creates deterministic sequence from same seed', () => {
    const a = createPRNG('test-seed');
    const b = createPRNG('test-seed');
    const seqA = Array.from({ length: 10 }, () => a.next());
    const seqB = Array.from({ length: 10 }, () => b.next());
    expect(seqA).toEqual(seqB);
  });

  it('produces different sequence from different seed', () => {
    const a = createPRNG('alpha');
    const b = createPRNG('beta');
    const seqA = Array.from({ length: 5 }, () => a.next());
    const seqB = Array.from({ length: 5 }, () => b.next());
    expect(seqA).not.toEqual(seqB);
  });

  it('getSeed returns the seed string', () => {
    const prng = createPRNG('hello');
    expect(prng.getSeed()).toBe('hello');
  });

  it('next returns values in [0, 1)', () => {
    const prng = createPRNG('bounds');
    for (let i = 0; i < 100; i++) {
      const v = prng.next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

describe('roll macro', () => {
  it('returns sum of dice', () => {
    const scope = buildScope('roll-test');
    const result = parseInt(render('{{roll count=2 sides=6}}', scope), 10);
    expect(result).toBeGreaterThanOrEqual(2);
    expect(result).toBeLessThanOrEqual(12);
  });

  it('defaults count to 1', () => {
    const scope = buildScope('roll-defaults');
    const result = parseInt(render('{{roll sides=20}}', scope), 10);
    expect(result).toBeGreaterThanOrEqual(1);
    expect(result).toBeLessThanOrEqual(20);
  });

  it('defaults sides to 6', () => {
    const scope = buildScope('roll-nosides');
    const result = parseInt(render('{{roll count=1}}', scope), 10);
    expect(result).toBeGreaterThanOrEqual(1);
    expect(result).toBeLessThanOrEqual(6);
  });

  it('is deterministic with same seed', () => {
    const a = render('{{roll count=3 sides=10}}', buildScope('det-roll'));
    const b = render('{{roll count=3 sides=10}}', buildScope('det-roll'));
    expect(a).toBe(b);
  });
});

describe('pick macro', () => {
  it('returns single item from list', () => {
    const scope = buildScope('pick-single');
    const result = render('{{pick from=["alpha","beta","gamma"]}}', scope);
    expect(['alpha', 'beta', 'gamma']).toContain(result);
  });

  it('returns array of items when count specified (text renders as JSON)', () => {
    const scope = buildScope('pick-count');
    const result = render('{{pick from=["a","b","c"] count=2}}', scope);
    const items: string[] = JSON.parse(result);
    expect(items).toHaveLength(2);
    for (const item of items) {
      expect(['a', 'b', 'c']).toContain(item);
    }
  });

  it('returns all items shuffled when count >= length', () => {
    const scope = buildScope('pick-all');
    const result = render('{{pick from=["x","y"] count=3}}', scope);
    const items: string[] = JSON.parse(result);
    expect(items).toHaveLength(2);
    expect(items).toContain('x');
    expect(items).toContain('y');
  });

  it('returns empty string for empty from', () => {
    const scope = buildScope('pick-empty');
    expect(render('{{pick from=[]}}', scope)).toBe('');
  });

  it('is deterministic with same seed', () => {
    const a = render('{{pick from=["d","e","f","g","h"] count=3}}', buildScope('det-pick'));
    const b = render('{{pick from=["d","e","f","g","h"] count=3}}', buildScope('det-pick'));
    expect(a).toBe(b);
  });
});

describe('int macro', () => {
  it('returns integer in range', () => {
    const scope = buildScope('int-range');
    const result = parseInt(render('{{int min=10 max=20}}', scope), 10);
    expect(result).toBeGreaterThanOrEqual(10);
    expect(result).toBeLessThanOrEqual(20);
  });

  it('defaults min=0 max=100', () => {
    const scope = buildScope('int-defaults');
    const result = parseInt(render('{{int}}', scope), 10);
    expect(result).toBeGreaterThanOrEqual(0);
    expect(result).toBeLessThanOrEqual(100);
  });

  it('is deterministic with same seed', () => {
    const a = render('{{int min=1 max=1000}}', buildScope('det-int'));
    const b = render('{{int min=1 max=1000}}', buildScope('det-int'));
    expect(a).toBe(b);
  });
});

describe('float macro', () => {
  it('returns float in range', () => {
    const scope = buildScope('float-range');
    const result = parseFloat(render('{{float min=0 max=10}}', scope));
    expect(result).toBeGreaterThanOrEqual(0);
    expect(result).toBeLessThan(10);
  });

  it('is deterministic with same seed', () => {
    const a = render('{{float}}', buildScope('det-float'));
    const b = render('{{float}}', buildScope('det-float'));
    expect(a).toBe(b);
  });
});

describe('seed macro', () => {
  it('returns current seed when PRNG present', () => {
    const scope = buildScope('my-seed');
    expect(render('{{seed}}', scope)).toBe('my-seed');
  });

  it('returns empty string when no PRNG', () => {
    const scope = buildScope();
    expect(render('{{seed}}', scope)).toBe('');
  });

  it('reports same seed before and after other macros', () => {
    const scope = buildScope('consistent-seed');
    const before = render('{{seed}}', scope);
    render('{{roll sides=100}}', scope);
    const after = render('{{seed}}', scope);
    expect(before).toBe(after);
  });
});

describe('core renderer backward compatibility', () => {
  it('unchanged macro returns empty string when no handler registered', () => {
    const scope: RenderScope = {
      variables: {},
      modifiers: {},
      blockHandlers: {},
      depth: 0,
      maxDepth: 32
    };
    const result = render('{{unknown_macro}}', scope);
    expect(result).toBe('');
  });

  it('variables still render correctly alongside macros', () => {
    const scope = buildScope('side-by-side');
    scope.variables = { name: 'World' };
    const result = render('Hello {name}, roll: {{roll sides=6}}', scope);
    expect(result).toMatch(/^Hello World, roll: [1-6]$/);
  });
});

describe('expandStateJson', () => {
  const scope = buildScope('expand-test');

  it('expands macros in flat object — typed output preserved', () => {
    const input = { count: '{{int min=1 max=10}}', name: 'fixed' };
    const result = expandStateJson(input, scope);
    expect(result.name).toBe('fixed');
    expect(typeof result.count).toBe('number');
    const count = result.count as number;
    expect(count).toBeGreaterThanOrEqual(1);
    expect(count).toBeLessThanOrEqual(10);
  });

  it('expands macros in nested objects', () => {
    const input = {
      outer: {
        inner: '{{pick from=["cat","dog","fish"]}}'
      }
    };
    const result = expandStateJson(input, scope);
    const inner = (result.outer as Record<string, unknown>).inner as string;
    expect(['cat', 'dog', 'fish']).toContain(inner);
  });

  it('expands macros in arrays', () => {
    const input = {
      items: ['{{pick from=["red","blue"]}}', '{{pick from=["green","yellow"]}}']
    };
    const result = expandStateJson(input, scope);
    const items = result.items as string[];
    expect(items).toHaveLength(2);
    expect(['red', 'blue']).toContain(items[0]);
    expect(['green', 'yellow']).toContain(items[1]);
  });

  it('leaves non-template strings unchanged', () => {
    const input = { plain: 'no template here', num: 42, bool: true };
    const result = expandStateJson(input, scope);
    expect(result).toEqual(input);
  });

  it('does not interpret single braces as templates', () => {
    const input = { json: '{not a template}' };
    const result = expandStateJson(input, scope);
    expect(result.json).toBe('{not a template}');
  });

  it('leaves unrecognized macros as empty string', () => {
    const input = { unknown: '{{nonexistent_macro arg="val"}}' };
    const result = expandStateJson(input, scope);
    expect(result.unknown).toBe('');
  });

  it('is deterministic with same seed — typed output', () => {
    const sa = buildScope('det-expand');
    const sb = buildScope('det-expand');
    const input = {
      a: '{{int min=1 max=100}}',
      b: '{{pick from=["x","y","z"]}}'
    };
    expect(expandStateJson(input, sa)).toEqual(expandStateJson(input, sb));
  });
});
