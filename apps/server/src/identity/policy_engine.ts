import { PolicyDecision, PolicyMatchInput, PolicyRule } from './types.js';

type FieldMatchRank = {
  effectRank: number;
  subjectRank: number;
  fieldRank: number;
  priority: number;
};

type ConditionInput = {
  input: PolicyMatchInput;
};

const getSubjectRank = (rule: PolicyRule, identityId: string, identityType: string): number => {
  if (rule.subject_id && rule.subject_id === identityId) {
    return 3;
  }
  if (rule.subject_type && rule.subject_type !== '*' && rule.subject_type === identityType) {
    return 2;
  }
  if (rule.subject_type === '*') {
    return 1;
  }
  return 0;
};

const getFieldRank = (field: string): number => {
  if (field === '*') {
    return 1;
  }
  if (field.endsWith('.*')) {
    return 2;
  }
  return 3;
};

const getEffectRank = (rule: PolicyRule): number => {
  return rule.effect === 'deny' ? 2 : 1;
};

const matchFieldPattern = (pattern: string, targetField: string): boolean => {
  if (pattern === '*') {
    return true;
  }
  if (pattern.endsWith('.*')) {
    const prefix = pattern.slice(0, -2);
    return targetField === prefix || targetField.startsWith(`${prefix}.`);
  }
  return pattern === targetField;
};

const matchArrayCondition = (expected: unknown, actual: unknown): boolean => {
  if (!Array.isArray(expected)) {
    return false;
  }
  if (Array.isArray(actual)) {
    return actual.some(item => expected.includes(item));
  }
  return expected.includes(actual);
};

const matchConditions = (rule: PolicyRule, conditionInput: ConditionInput): boolean => {
  if (!rule.conditions || Object.keys(rule.conditions).length === 0) {
    return true;
  }

  const attributes = {
    ...(conditionInput.input.identity.claims ?? {}),
    ...(conditionInput.input.attributes ?? {})
  };

  for (const [key, expected] of Object.entries(rule.conditions)) {
    const actual = attributes[key];
    if (Array.isArray(expected)) {
      if (!matchArrayCondition(expected, actual)) {
        return false;
      }
      continue;
    }
    if (actual !== expected) {
      return false;
    }
  }
  return true;
};

const compareRuleOrder = (a: FieldMatchRank, b: FieldMatchRank): number => {
  if (a.effectRank !== b.effectRank) {
    return b.effectRank - a.effectRank;
  }
  if (a.subjectRank !== b.subjectRank) {
    return b.subjectRank - a.subjectRank;
  }
  if (a.fieldRank !== b.fieldRank) {
    return b.fieldRank - a.fieldRank;
  }
  return b.priority - a.priority;
};

const matchRuleBase = (rule: PolicyRule, input: PolicyMatchInput): boolean => {
  const subjectRank = getSubjectRank(rule, input.identity.id, input.identity.type);
  if (subjectRank === 0) {
    return false;
  }
  if (rule.resource !== input.resource) {
    return false;
  }
  if (rule.action !== input.action) {
    return false;
  }
  return matchConditions(rule, { input });
};

export const normalizeRulesOrder = (rules: PolicyRule[], input: PolicyMatchInput): PolicyRule[] => {
  return [...rules]
    .map(rule => {
      const subjectRank = getSubjectRank(rule, input.identity.id, input.identity.type);
      return {
        rule,
        rank: {
          effectRank: getEffectRank(rule),
          subjectRank,
          fieldRank: getFieldRank(rule.field),
          priority: rule.priority
        }
      };
    })
    .sort((a, b) => compareRuleOrder(a.rank, b.rank))
    .map(item => item.rule);
};

export const evaluateFieldPolicies = (
  rules: PolicyRule[],
  input: PolicyMatchInput,
  fields: string[]
): Map<string, PolicyDecision> => {
  const results = new Map<string, PolicyDecision>();
  const ordered = normalizeRulesOrder(rules, input);

  for (const rule of ordered) {
    if (!matchRuleBase(rule, input)) {
      continue;
    }

    if (rule.field === '*') {
      const wildcardDecision = results.get('*');
      if (!wildcardDecision) {
        results.set('*', {
          allow: rule.effect === 'allow',
          reason: `${rule.effect}:${rule.id}`,
          ruleId: rule.id,
          effect: rule.effect,
          matchedPattern: '*'
        });
      }
    }

    for (const targetField of fields) {
      if (!matchFieldPattern(rule.field, targetField)) {
        continue;
      }
      const existing = results.get(targetField);
      if (existing) {
        continue;
      }
      results.set(targetField, {
        allow: rule.effect === 'allow',
        reason: `${rule.effect}:${rule.id}`,
        ruleId: rule.id,
        effect: rule.effect,
        matchedPattern: rule.field
      });
    }
  }

  return results;
};

export const resolveFieldDecision = (
  field: string,
  decisions: Map<string, PolicyDecision>
): PolicyDecision => {
  const wildcard = decisions.get(field);
  if (wildcard) {
    return wildcard;
  }
  return { allow: false, reason: 'default_deny', effect: 'deny', matchedPattern: 'default_deny' };
};

export const resolveAllowedFields = (
  fields: string[],
  decisions: Map<string, PolicyDecision>
): Set<string> => {
  const allowed = new Set<string>();
  for (const field of fields) {
    const decision = resolveFieldDecision(field, decisions);
    if (decision.allow) {
      allowed.add(field);
    }
  }
  return allowed;
};
