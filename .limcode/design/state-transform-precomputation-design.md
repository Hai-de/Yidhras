# State Transform Precomputation Design

## Problem

Pack authors attempt complex conditional expressions in templates, but the narrative template engine only supports interpolation, `default()`, `#if`, and `#each`. There is no native support for range-based mapping (e.g., "if public_opinion is between 31-70, label it 'medium'").

This forces pack authors to write deeply nested `{{#if}}` chains in their templates, which are fragile, hard to maintain, and produce opaque error messages.

## Solution: `state_transforms` Declaration

A new top-level pack constitution field `state_transforms` allows pack authors to declare range-based mappings from numeric source state keys to labeled target state keys.

### Schema Definition

```yaml
state_transforms:
  - source: public_opinion        # Source state key (numeric)
    ranges:
      - min: 0
        max: 30
        label: "low"
      - min: 31
        max: 70
        label: "medium"
      - min: 71
        max: 100
        label: "high"
    target: public_opinion_stage   # Target state key (string)
```

### Zod Schema

```typescript
const stateTransformRangeSchema = z.object({
  min: z.number(),
  max: z.number(),
  label: nonEmptyStringSchema
}).strict();

const stateTransformSchema = z.object({
  source: nonEmptyStringSchema,
  ranges: z.array(stateTransformRangeSchema),
  target: nonEmptyStringSchema
}).strict().superRefine((value, ctx) => {
  // Validate min <= max, unique labels
});
```

### Materialization

During `materializePackRuntimeCoreModels`, each `state_transform` is stored as a `PackWorldEntity` with:
- `entity_kind`: `'state_transform'`
- `entity_id`: the `target` field value
- `payload`: the full transform definition (source, ranges, target)
- No entity state is created — transforms are definitions, not state

### Template Usage (Future)

After evaluation engine implementation, pack authors will be able to use:
```
{{actor_state.public_opinion_stage}}
```

The evaluation engine will:
1. Read the transform from the pack's world entities
2. Look up the source key (`public_opinion`) in actor state
3. Find the matching range (min <= value <= max)
4. Write the label to the target key (`public_opinion_stage`) in actor state
5. The template engine then resolves `{{actor_state.public_opinion_stage}}` naturally

### Current Implementation Status

- [x] Schema definition with validation (min <= max, unique labels)
- [x] Zod type export (`WorldPackStateTransform`)
- [x] Materialization: stored as `PackWorldEntity` with `entity_kind = 'state_transform'`
- [x] Summary count (`state_transform_count`) in materialize result
- [ ] Evaluation engine: triggered during simulation tick or on-demand
- [ ] Template variable resolution: `{{actor_state.<target>}}` resolves via transform

### Validation Rules

1. `ranges[].min` must be <= `ranges[].max`
2. `ranges[].label` values must be unique within a transform
3. `source` and `target` must be non-empty strings
4. Transforms are declarative — no runtime expression evaluation