import { describe, expect, it } from 'vitest';

import { dataCleanerRegistry } from '../../src/plugins/extensions/data_cleaner_registry.js';
import type { DataCleaner, DataCleanerInput } from '@yidhras/contracts';
import { createParser, render } from '../../src/template_engine/frontends/data_cleaner/index.js';
import { tokenize } from '../../src/template_engine/core/lexer.js';
import { parse } from '../../src/template_engine/core/parser.js';
import { renderAst } from '../../src/template_engine/core/renderer.js';
import { BUILTIN_BLOCK_HANDLERS, BUILTIN_MODIFIERS, DEFAULT_SYNTAX } from '../../src/template_engine/defaults.js';
import type { AstNode, RenderScope, SyntaxConfig } from '../../src/template_engine/core/types.js';
import { slotRefBlockHandler } from '../../src/template_engine/frontends/slot_function/blocks.js';
import type { SlotRegistry } from '../../src/template_engine/frontends/slot_function/types.js';
import { renderNarrativeTemplate } from '../../src/template_engine/frontends/narrative/resolver.js';
import { createNarrativeBlockHandlers } from '../../src/template_engine/frontends/narrative/blocks.js';
import { createPromptVariableContext, createPromptVariableLayer, normalizePromptVariableRecord } from '../../src/template_engine/frontends/narrative/variable_context.js';

const createTemplateCleaner = (): DataCleaner => {
  return {
    key: 'data_cleaner.template',
    version: '1.0.0',
    async clean(input: DataCleanerInput) {
      const { text, options } = input;
      const { render: dynRender } = await import('../../src/template_engine/frontends/data_cleaner/index.js');
      const variables = (options?.variables as Record<string, unknown>) ?? {};
      let rendered: string;
      try {
        rendered = dynRender(text, variables);
      } catch {
        rendered = text;
      }
      return {
        cleaned: rendered,
        metadata: {
          variable_count: Object.keys(variables).length,
          input_length: text.length,
          output_length: rendered.length
        }
      };
    }
  };
};

describe('template engine — Data Cleaner frontend integration', () => {
  it('render() with variables substituted via DataCleaner flow', () => {
    const result = render(
      'Agent {agent_id} reports: {status|upper}',
      { agent_id: 'A7', status: 'active' }
    );

    expect(result).toBe('Agent A7 reports: ACTIVE');
  });

  it('render() handles missing variables gracefully (empty string)', () => {
    const result = render('Hello {missing_name}', {});

    expect(result).toBe('Hello ');
  });

  it('createParser() with custom modifier integrates with render pipeline', () => {
    const parser = createParser({
      modifiers: {
        reverse: (value: unknown) => String(value).split('').reverse().join('')
      }
    });

    const result = parser.render('{name|reverse}', { name: 'hello' });

    expect(result).toBe('olleh');
  });

  it('createParser() with custom block handler integrates with render pipeline', () => {
    const parser = createParser({
      blockHandlers: {
        box: (_condition: string, body: AstNode[], _elseBody: AstNode[] | undefined, scope: RenderScope, renderFn) => {
          return `[${renderFn(body, scope)}]`;
        }
      }
    });

    const result = parser.render('{{#box}}{msg}{{/box}}', { msg: 'hello' });

    expect(result).toBe('[hello]');
  });

  it('parse + renderAst two-step allows AST manipulation', () => {
    const tokens = tokenize('Hello {name}', DEFAULT_SYNTAX);
    const { nodes } = parse(tokens, DEFAULT_SYNTAX);

    nodes.push({ type: 'text', content: '!' });

    const scope: RenderScope = {
      variables: { name: 'World' },
      modifiers: BUILTIN_MODIFIERS,
      blockHandlers: BUILTIN_BLOCK_HANDLERS,
      depth: 0,
      maxDepth: 32
    };
    const result = renderAst(nodes, scope);

    expect(result).toBe('Hello World!');
  });

  it('custom syntax delimiters integrate through full pipeline', () => {
    const customSyntax: Partial<SyntaxConfig> = {
      delimiters: {
        variable: { open: '<<', close: '>>' },
        macro: { open: '<<<', close: '>>>' },
        blockOpen: { open: '<<<#', close: '>>>' },
        blockClose: { open: '<</', close: '>>>' },
        comment: { open: '<<!--', close: '-->>' },
        escape: '\\'
      }
    };

    const result = render('Hello <<name|upper>>', { name: 'alice' }, customSyntax);

    expect(result).toBe('Hello ALICE');
  });

  it('DataCleaner plugin registry integration — register and use', async () => {
    const cleaner = createTemplateCleaner();
    dataCleanerRegistry.register(cleaner);

    const retrieved = dataCleanerRegistry.get('data_cleaner.template');
    expect(retrieved).toBeDefined();

    const output = await retrieved!.clean({
      text: '{greeting}, {target|upper}',
      options: { variables: { greeting: 'Hello', target: 'world' } }
    });

    expect(output.cleaned).toBe('Hello, WORLD');
    expect(output.metadata).toMatchObject({
      variable_count: 2,
      input_length: '{greeting}, {target|upper}'.length
    });
  });
});

describe('template engine — slot function integration', () => {
  const buildSlotRegistry = (): SlotRegistry => ({
    system_core: {
      content: '核心系统指令内容',
      enabled: true
    },
    system_policy: {
      content: '策略规则内容',
      enabled: false
    },
    world_context: {
      content: '世界观背景内容',
      enabled: true
    }
  });

  it('slot-ref block handler renders slot content when slot is enabled', () => {
    const slotRegistry = buildSlotRegistry();

    const scope: RenderScope = {
      variables: {},
      modifiers: BUILTIN_MODIFIERS,
      blockHandlers: {
        ...BUILTIN_BLOCK_HANDLERS,
        'slot-ref': slotRefBlockHandler
      },
      depth: 0,
      maxDepth: 32
    };

    const nodes: AstNode[] = [{
      type: 'block',
      keyword: 'slot-ref',
      condition: '"system_core"',
      body: [{ type: 'text', content: 'fallback-content' }]
    }];

    const extendedScope = { ...scope, slotRegistry };
    const result = renderAst(nodes, extendedScope);

    expect(result).toBe('核心系统指令内容');
  });

  it('slot-ref block handler renders fallback body when slot is disabled', () => {
    const slotRegistry = buildSlotRegistry();

    const scope: RenderScope = {
      variables: {},
      modifiers: BUILTIN_MODIFIERS,
      blockHandlers: {
        ...BUILTIN_BLOCK_HANDLERS,
        'slot-ref': slotRefBlockHandler
      },
      depth: 0,
      maxDepth: 32
    };

    const nodes: AstNode[] = [{
      type: 'block',
      keyword: 'slot-ref',
      condition: '"system_policy"',
      body: [{ type: 'text', content: '默认策略内容' }]
    }];

    const extendedScope = { ...scope, slotRegistry };
    const result = renderAst(nodes, extendedScope);

    expect(result).toBe('默认策略内容');
  });

  it('slot-ref block handler returns empty when slot not in registry', () => {
    const slotRegistry = buildSlotRegistry();

    const scope: RenderScope = {
      variables: {},
      modifiers: BUILTIN_MODIFIERS,
      blockHandlers: {
        ...BUILTIN_BLOCK_HANDLERS,
        'slot-ref': slotRefBlockHandler
      },
      depth: 0,
      maxDepth: 32
    };

    const nodes: AstNode[] = [{
      type: 'block',
      keyword: 'slot-ref',
      condition: '"nonexistent_slot"',
      body: []
    }];

    const extendedScope = { ...scope, slotRegistry };
    const result = renderAst(nodes, extendedScope);

    expect(result).toBe('');
  });

  it('slot-ref integrates with Narrative frontend via block handler registration', () => {
    const slotRegistry = buildSlotRegistry();
    const narrativeHandlers = createNarrativeBlockHandlers();

    const ctx = createPromptVariableContext({
      layers: [
        createPromptVariableLayer({
          namespace: 'pack',
          values: normalizePromptVariableRecord({ test: 'value' }),
          metadata: { source_label: 'pack', trusted: true }
        })
      ]
    });

    const tokens = tokenize(
      '{{#slot-ref "system_core"}}fallback{{/slot-ref}}',
      {
        ...DEFAULT_SYNTAX,
        delimiters: {
          ...DEFAULT_SYNTAX.delimiters,
          variable: { open: '{{', close: '}}' }
        },
        blocks: {
          ...DEFAULT_SYNTAX.blocks,
          keywords: [...DEFAULT_SYNTAX.blocks.keywords, 'slot-ref']
        }
      }
    );

    const { nodes } = parse(tokens, {
      ...DEFAULT_SYNTAX,
      delimiters: {
        ...DEFAULT_SYNTAX.delimiters,
        variable: { open: '{{', close: '}}' }
      },
      blocks: {
        ...DEFAULT_SYNTAX.blocks,
        keywords: [...DEFAULT_SYNTAX.blocks.keywords, 'slot-ref']
      }
    });

    const scope: RenderScope = {
      variables: {},
      modifiers: BUILTIN_MODIFIERS,
      blockHandlers: {
        ...narrativeHandlers,
        'slot-ref': slotRefBlockHandler
      },
      depth: 0,
      maxDepth: 32
    };

    const extendedScope = { ...scope, slotRegistry, variableContext: ctx };
    const result = renderAst(nodes, extendedScope);

    expect(result).toBe('核心系统指令内容');
  });

  it('nested slot-ref with narrative variable inside fallback', () => {
    const slotRegistry: SlotRegistry = {
      disabled_slot: { content: '不应出现', enabled: false }
    };

    const ctx = createPromptVariableContext({
      layers: [
        createPromptVariableLayer({
          namespace: 'pack',
          values: normalizePromptVariableRecord({ default_msg: '回退消息' }),
          metadata: { source_label: 'pack', trusted: true }
        })
      ]
    });

    // When slot is disabled, the fallback body renders
    // The fallback contains a Narrative variable {{ pack.default_msg }}
    const result = renderNarrativeTemplate({
      template: '{{#slot-ref "disabled_slot"}}{{ pack.default_msg }}{{/slot-ref}}',
      variableContext: ctx
    });

    // slot-ref is not registered as a block handler in the Narrative frontend's
    // default syntax, so the block keyword won't be recognized.
    // This test verifies the current behavior: unrecognized block → empty output
    expect(result.text).toBe('');
  });
});

describe('template engine — error resilience integration', () => {
  it('render() survives deeply nested blocks (depth protection)', () => {
    // Build a template with 40 nested #if blocks (exceeds maxDepth=32)
    let template = 'bottom';
    for (let i = 0; i < 40; i++) {
      template = `{{#if flag}}${template}{{/if}}`;
    }

    const result = render(template, { flag: true });

    // Should not throw; output truncated when depth exhausted
    expect(typeof result).toBe('string');
  });

  it('renderNarrativeTemplate survives illegal template patterns gracefully', () => {
    const ctx = createPromptVariableContext({
      layers: [
        createPromptVariableLayer({
          namespace: 'pack',
          values: normalizePromptVariableRecord({ test: 'ok' }),
          metadata: { source_label: 'pack', trusted: true }
        })
      ]
    });

    const result = renderNarrativeTemplate({
      template: 'test {{$$$}} pattern',
      variableContext: ctx
    });

    // Should return empty text with INVALID_TEMPLATE error, not throw
    expect(result.diagnostics.errors.length).toBeGreaterThan(0);
    expect(result.diagnostics.errors[0]!.code).toBe('INVALID_TEMPLATE');
  });

  it('renderNarrativeTemplate handles empty template', () => {
    const result = renderNarrativeTemplate({
      template: '',
      variableContext: createPromptVariableContext()
    });

    expect(result.text).toBe('');
    expect(result.diagnostics.errors).toEqual([]);
  });
});
