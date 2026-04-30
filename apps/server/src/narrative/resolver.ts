import { AccessLevel, InformationMetadata, PermissionContext } from '../permission/types.js';
import { createLogger } from '../utils/logger.js';
import type {
  PromptMacroBlockTrace,
  PromptMacroRenderResult,
  PromptVariableContext,
  PromptVariableRecord,
  PromptVariableResolutionTrace,
  PromptVariableValue
} from './types.js';
import {
  buildEmptyPromptMacroDiagnostics,
  collectNamespacesFromTrace,
  createPromptVariableContext,
  createPromptVariableLayer,
  lookupPromptVariable,
  mergePromptMacroDiagnostics,
  normalizePromptVariableRecord,
  previewPromptVariableValue
} from './variable_context.js';

const logger = createLogger('narrative-resolver');

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
};
interface RenderInput {
  context: PromptVariableContext;
  localScope: Record<string, unknown>;
  templateSource?: string;
}

interface RenderPassResult {
  text: string;
  diagnostics: PromptMacroRenderResult['diagnostics'];
  changed: boolean;
}

interface InterpolationSpec {
  path: string;
  defaultValue?: unknown;
}

const TEMPLATE_TOKEN_PATTERN = /\{\{[#/]?[^{}]+\}\}/;

const parseLiteralValue = (input: string): unknown => {
  const trimmed = input.trim();

  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1);
  }
  if (trimmed === 'true') {
    return true;
  }
  if (trimmed === 'false') {
    return false;
  }
  if (trimmed === 'null') {
    return null;
  }
  // eslint-disable-next-line security/detect-unsafe-regex -- simple number parsing, bounded input
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) {
    return Number(trimmed);
  }
  return trimmed;
};

const parseInterpolationSpec = (expression: string): InterpolationSpec | null => {
  const trimmed = expression.trim();
  // eslint-disable-next-line security/detect-unsafe-regex -- internal config expression parser, bounded
  const match = trimmed.match(/^([\w.]+)(?:\s*\|\s*default\((.*)\))?$/);
  if (!match) {
    return null;
  }

  const [, path, defaultLiteral] = match;
  return {
    path,
    defaultValue: defaultLiteral !== undefined ? parseLiteralValue(defaultLiteral) : undefined
  };
};

const parseEachSpec = (expression: string): { path: string; alias: string } | null => {
  const trimmed = expression.trim();
  const match = trimmed.match(/^([\w.]+)\s+as\s+([A-Za-z_][\w]*)$/);
  if (!match) {
    return null;
  }

  return {
    path: match[1],
    alias: match[2]
  };
};

const isTruthyMacroValue = (value: unknown): boolean => {
  if (value === null || value === undefined) {
    return false;
  }
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'number') {
    return value !== 0;
  }
  if (typeof value === 'string') {
    return value.length > 0;
  }
  if (Array.isArray(value)) {
    return value.length > 0;
  }
  if (isRecord(value)) {
    return Object.keys(value).length > 0;
  }
  return Boolean(value);
};

const pushTraceDiagnostics = (
  diagnostics: PromptMacroRenderResult['diagnostics'],
  trace: PromptVariableResolutionTrace
): void => {
  diagnostics.traces.push(trace);
  diagnostics.namespaces_used = Array.from(
    new Set([...(diagnostics.namespaces_used ?? []), ...collectNamespacesFromTrace(trace)])
  );

  if (trace.missing) {
    diagnostics.missing_paths.push(trace.requested_path);
  }
  if (trace.restricted) {
    diagnostics.restricted_paths.push(trace.requested_path);
  }
};

const dedupeDiagnostics = (
  diagnostics: PromptMacroRenderResult['diagnostics']
): PromptMacroRenderResult['diagnostics'] => ({
  ...diagnostics,
  missing_paths: Array.from(new Set(diagnostics.missing_paths)),
  restricted_paths: Array.from(new Set(diagnostics.restricted_paths))
});

export class NarrativeResolver {
  private variables: Record<string, { value: PromptVariableValue; meta?: InformationMetadata }> = {};
  private readonly MAX_RECURSION_DEPTH = 10;
  private readonly MAX_TEMPLATE_OUTPUT_LENGTH = 32_000;

  // 非法占位符模式（如：带有特殊控制符、不完整的 {{）
  private readonly ILLEGAL_PATTERN = /\{\{[^\w.#|()\-\s"',/]+\}\}/g;

  constructor(initialVariables: PromptVariableRecord = {}) {
    this.updateVariables(initialVariables);
  }

  /**
   * 更新变量池，并附带元数据支持（如：权限等级）
   */
  public updateVariables(newVars: PromptVariableRecord, metadataMap: Record<string, InformationMetadata> = {}): void {
    for (const [key, value] of Object.entries(newVars)) {
// eslint-disable-next-line security/detect-object-injection -- 从内部枚举构造的键
      this.variables[key] = {
        value,
// eslint-disable-next-line security/detect-object-injection -- 从内部枚举构造的键
        meta: metadataMap[key] || { id: key, min_level: AccessLevel.PUBLIC }
      };
    }
  }

  /**
   * 解析模板
   */
  public resolve(template: string, extraContext: PromptVariableRecord = {}, permission?: PermissionContext): string {
    return this.render(template, {
      extraContext,
      permission
    }).text;
  }

  public render(
    template: string,
    options: {
      extraContext?: Record<string, unknown>;
      permission?: PermissionContext;
      variableContext?: PromptVariableContext;
      templateSource?: string;
      localScope?: Record<string, unknown>;
    } = {}
  ): PromptMacroRenderResult {
    try {
      if (this.ILLEGAL_PATTERN.test(template)) {
        logger.warn(`Illegal pattern found in template: ${template}`);
        return {
          text: '[INVALID_TEMPLATE_CONTENT]',
          diagnostics: {
            ...buildEmptyPromptMacroDiagnostics(options.templateSource),
            output_length: '[INVALID_TEMPLATE_CONTENT]'.length
          }
        };
      }

      const visiblePool = this.buildVisiblePool(options.permission);
      const variableContext = options.variableContext ?? createPromptVariableContext({
        layers: [
          createPromptVariableLayer({
            namespace: 'pack',
            values: normalizePromptVariableRecord(visiblePool),
            alias_values: normalizePromptVariableRecord({
              ...visiblePool,
              ...(options.extraContext ?? {})
            }),
            metadata: {
              source_label: 'narrative-resolver-visible-pool',
              trusted: true
            }
          })
        ]
      });

      const localScope = {
        ...(options.extraContext ?? {}),
        ...(options.localScope ?? {})
      };

      return this.recursiveRender(
        template,
        {
          context: variableContext,
          localScope,
          templateSource: options.templateSource
        },
        0
      );
    } catch (error) {
      logger.error('Critical Error during resolve', { error: error instanceof Error ? error.message : String(error) });
      return {
        text: '[TEMPLATE_RENDER_RECOVERED]',
        diagnostics: {
          ...buildEmptyPromptMacroDiagnostics(options.templateSource),
          output_length: '[TEMPLATE_RENDER_RECOVERED]'.length
        }
      };
    }
  }

  /**
   * 检查 Agent 权限是否满足要求
   */
  private canAccess(meta?: InformationMetadata, permission?: PermissionContext): boolean {
    if (!meta || meta.min_level === AccessLevel.PUBLIC) return true;
    if (!permission) return false;

    // A. 基础等级达标
    if (permission.global_level >= meta.min_level) return true;

    // B. 所属特定圈子满足
    if (meta.circle_id && permission.circles.has(meta.circle_id)) return true;

    return false;
  }

  private buildVisiblePool(permission?: PermissionContext): PromptVariableRecord {
    const visiblePool: PromptVariableRecord = {};
    for (const [key, entry] of Object.entries(this.variables)) {
      if (this.canAccess(entry.meta, permission)) {
// eslint-disable-next-line security/detect-object-injection -- 从内部枚举构造的键
        visiblePool[key] = entry.value;
      }
    }
    return visiblePool;
  }

  private recursiveRender(template: string, input: RenderInput, depth: number): PromptMacroRenderResult {
    if (depth >= this.MAX_RECURSION_DEPTH) {
      logger.warn('Max recursion depth reached.');
      return {
        text: template,
        diagnostics: {
          ...buildEmptyPromptMacroDiagnostics(input.templateSource),
          output_length: template.length
        }
      };
    }

    const eachPass = this.processEachBlocks(template, input, depth);
    const ifPass = this.processIfBlocks(eachPass.text, input, depth);
    const interpolationPass = this.processInterpolations(ifPass.text, input);
    const mergedDiagnostics = dedupeDiagnostics(
      mergePromptMacroDiagnostics(
        mergePromptMacroDiagnostics(eachPass.diagnostics, ifPass.diagnostics),
        interpolationPass.diagnostics
      )
    );
    const text = interpolationPass.text;

    if (text.length > this.MAX_TEMPLATE_OUTPUT_LENGTH) {
      return {
        text: '[TEMPLATE_OUTPUT_LIMIT_EXCEEDED]',
        diagnostics: {
          ...mergedDiagnostics,
          output_length: '[TEMPLATE_OUTPUT_LIMIT_EXCEEDED]'.length
        }
      };
    }

    if ((eachPass.changed || ifPass.changed || interpolationPass.changed) && TEMPLATE_TOKEN_PATTERN.test(text)) {
      const nested = this.recursiveRender(text, input, depth + 1);
      return {
        text: nested.text,
        diagnostics: dedupeDiagnostics(mergePromptMacroDiagnostics(mergedDiagnostics, nested.diagnostics))
      };
    }

    return {
      text,
      diagnostics: {
        ...mergedDiagnostics,
        output_length: text.length
      }
    };
  }

  private processInterpolations(template: string, input: RenderInput): RenderPassResult {
    const diagnostics = buildEmptyPromptMacroDiagnostics(input.templateSource);
    let changed = false;
    const regex = /\{\{\s*([^#/{][^{}]*?)\s*\}\}/g;

    const text = template.replace(regex, (match: string, expression: string) => {
      const spec = parseInterpolationSpec(expression);
      if (!spec) {
        diagnostics.missing_paths.push(expression.trim());
        return '[INVALID_TEMPLATE_EXPRESSION]';
      }

      const lookup = lookupPromptVariable({
        expression: match,
        path: spec.path,
        context: input.context,
        localScope: input.localScope
      });

      let resolvedValue = lookup.value;
      let resolvedTrace = lookup.trace;
      const shouldApplyDefault =
        spec.defaultValue !== undefined
        && (resolvedValue === undefined || resolvedValue === null || resolvedValue === '');

      if (shouldApplyDefault) {
        resolvedValue = spec.defaultValue;
        resolvedTrace = {
          ...lookup.trace,
          resolved: true,
          missing: false,
          fallback_applied: true,
          value_preview: previewPromptVariableValue(spec.defaultValue, Number.MAX_SAFE_INTEGER),
          notes: [...(lookup.trace.notes ?? []), 'default_applied']
        };
      }

      pushTraceDiagnostics(diagnostics, resolvedTrace);

      if (resolvedValue !== undefined) {
        changed = true;
        return previewPromptVariableValue(resolvedValue, Number.MAX_SAFE_INTEGER);
      }

      return '[RESTRICTED_OR_MISSING]';
    });

    return {
      text,
      diagnostics: dedupeDiagnostics(diagnostics),
      changed
    };
  }

  private processIfBlocks(template: string, input: RenderInput, depth: number): RenderPassResult {
    const diagnostics = buildEmptyPromptMacroDiagnostics(input.templateSource);
    let changed = false;
    const regex = /\{\{#if\s+([^{}]+?)\s*\}\}([\s\S]*?)\{\{\/if\}\}/g;

    const text = template.replace(regex, (match: string, expression: string, body: string) => {
      const lookup = lookupPromptVariable({
        expression: expression.trim(),
        path: expression.trim(),
        context: input.context,
        localScope: input.localScope
      });

      pushTraceDiagnostics(diagnostics, lookup.trace);
      const executed = isTruthyMacroValue(lookup.value);
      const blockTrace: PromptMacroBlockTrace = {
        kind: 'if',
        expression: expression.trim(),
        executed
      };
      diagnostics.blocks?.push(blockTrace);
      changed = true;

      if (!executed) {
        return '';
      }

      const nested = this.recursiveRender(body, input, depth + 1);
      const merged = mergePromptMacroDiagnostics(diagnostics, nested.diagnostics);
      diagnostics.traces = merged.traces;
      diagnostics.missing_paths = merged.missing_paths;
      diagnostics.restricted_paths = merged.restricted_paths;
      diagnostics.blocks = merged.blocks;
      diagnostics.namespaces_used = merged.namespaces_used;
      diagnostics.output_length = merged.output_length;
      return nested.text;
    });

    return {
      text,
      diagnostics: dedupeDiagnostics(diagnostics),
      changed
    };
  }

  private processEachBlocks(template: string, input: RenderInput, depth: number): RenderPassResult {
    const diagnostics = buildEmptyPromptMacroDiagnostics(input.templateSource);
    let changed = false;
    const regex = /\{\{#each\s+([^{}]+?)\s*\}\}([\s\S]*?)\{\{\/each\}\}/g;

    const text = template.replace(regex, (match: string, expression: string, body: string) => {
      const spec = parseEachSpec(expression);
      if (!spec) {
        diagnostics.missing_paths.push(expression.trim());
        changed = true;
        return '[INVALID_TEMPLATE_EACH]';
      }

      const lookup = lookupPromptVariable({
        expression: expression.trim(),
        path: spec.path,
        context: input.context,
        localScope: input.localScope
      });

      pushTraceDiagnostics(diagnostics, lookup.trace);
      changed = true;

      if (!Array.isArray(lookup.value)) {
        diagnostics.blocks?.push({
          kind: 'each',
          expression: spec.path,
          executed: false,
          iteration_count: 0,
          alias: spec.alias
        });
        return '';
      }

      diagnostics.blocks?.push({
        kind: 'each',
        expression: spec.path,
        executed: lookup.value.length > 0,
        iteration_count: lookup.value.length,
        alias: spec.alias
      });

      return lookup.value
        .map(entry => {
          const nested = this.recursiveRender(
            body,
            {
              ...input,
              localScope: {
                ...input.localScope,
                [spec.alias]: entry as Record<string, unknown>
              }
            },
            depth + 1
          );
          const merged = mergePromptMacroDiagnostics(diagnostics, nested.diagnostics);
          diagnostics.traces = merged.traces;
          diagnostics.missing_paths = merged.missing_paths;
          diagnostics.restricted_paths = merged.restricted_paths;
          diagnostics.blocks = merged.blocks;
          diagnostics.namespaces_used = merged.namespaces_used;
          diagnostics.output_length = merged.output_length;
          return nested.text;
        })
        .join('');
    });

    return {
      text,
      diagnostics: dedupeDiagnostics(diagnostics),
      changed
    };
  }
}

export const renderNarrativeTemplate = (input: {
  template: string;
  variableContext: PromptVariableContext;
  extraContext?: Record<string, unknown>;
  permission?: PermissionContext;
  templateSource?: string;
}): PromptMacroRenderResult => {
  const resolver = new NarrativeResolver();
  return resolver.render(input.template, {
    variableContext: input.variableContext,
    extraContext: input.extraContext,
    permission: input.permission,
    templateSource: input.templateSource
  });
};
