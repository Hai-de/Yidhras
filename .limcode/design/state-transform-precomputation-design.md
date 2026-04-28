# State Transform Precomputation Design

## Problem

Pack authors attempt complex conditional expressions in templates, but the narrative template engine only supports interpolation, `default()`, `#if`, and `#each`. There is no native support for range-based mapping (e.g., "if public_opinion is between 31-70, label it 'medium'").

This forces pack authors to write deeply nested `{{#if}}` chains in their templates, which are fragile, hard to maintain, and produce opaque error messages.

## Solution: `state_transforms` Declaration

A new top-level pack constitution field `state_transforms` allows pack authors to declare range-based mappings from numeric source state keys to labeled target state keys.

### Schema Definition

```yaml
state_transforms:
  - source: public_opinion        # Source state key (numeric) in actor state_json
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
    target: public_opinion_stage   # Target state key written to same actor's state_json
```

### Design Decisions

- **Pack-level declaration, per-actor evaluation**: transforms are declared at the pack level and applied to every actor during each simulation tick. The same transform rule is reused across actors.
- **source / target semantics**: `source` is a key in the current actor's `state_json` (namespace `core`). `target` is a key written into the same actor's `state_json`. The actor must hold the source value; the derived label is co-located.
- **Eager evaluation**: transforms are evaluated during `executeWorldEnginePreparedStep`, after `prepareStep` returns and before the delta is persisted. This ensures `{{actor_state.<target>}}` resolves naturally via existing variable interpolation — the template engine needs no changes.
- **Only numeric source values**: if the source value is not a number, the transform is skipped for that actor with a debug log.
- **No matching range**: if the source value falls outside all ranges (including gaps between ranges), the target key is left unchanged and a warning is logged.
- **Duplicate targets are a schema error**: the pack constitution validation rejects any `state_transforms` array where two transforms share the same `target` key.
- **`upsert_entity_state` semantics**: the delta operation replaces the entire `state_json`. The implementation must read the actor's current state, spread it, overwrite the target key, and write back the merged object — following the same pattern as `default_step_contributor.ts`.

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

### Evaluation Engine (per-tick, eager)

During `executeWorldEnginePreparedStep`, after the sidecar `prepareStep` returns:

1. Load `world_entities` for the active pack, filter to actor entities (`entity_kind` matching actor, default `'actor'`)
2. For each actor, read its current `state_json` (namespace `core`)
3. Load all `state_transform` entities from `world_entities`
4. For each transform × actor:
   - Read `state_json[transform.source]`
   - If missing or not a number → debug log, skip
   - Find range where `min <= value <= max`
   - If no match → warning log (gap or out-of-range), skip
   - If match → set `state_json[transform.target] = range.label`
5. Merge changed actor states into `upsert_entity_state` delta operations
6. Append operations to `prepared.state_delta.operations` before persist

### Template Usage

After evaluation, pack authors use standard interpolation — no template engine changes needed:

```
{{actor_state.public_opinion_stage}}
```

The `actor_state` namespace layer in `resolvePackVariables` already reads the actor's `state_json` keys, so any target key written by the evaluation engine resolves automatically.

### Integration Point

Inserted into `executeWorldEnginePreparedStep` (`world_engine_persistence.ts`) between the `prepareStep` call (line 354) and the `persistPreparedStep` call (line 362). The `StepContributor` registry pattern (`world_engine_contributors.ts`) is defined but not yet wired into the sidecar-based prepare pipeline; transforms are applied directly rather than through the contributor abstraction. If the contributor system is wired later, the transform logic can be lifted into a `StepContributor` without changing its internal logic.

### Validation Rules

1. `ranges[].min` must be <= `ranges[].max`
2. `ranges[].label` values must be unique within a transform
3. `source` and `target` must be non-empty strings
4. Duplicate `target` values across transforms are rejected at schema level
5. Source value must be numeric — non-numeric skips with debug log
6. No matching range skips with warning log (covers gaps and out-of-range)
7. Transforms are declarative — no runtime expression evaluation

### Current Implementation Status

- [x] Schema definition with validation (min <= max, unique labels)
- [x] Zod type export (`WorldPackStateTransform`)
- [x] Materialization: stored as `PackWorldEntity` with `entity_kind = 'state_transform'`
- [x] Summary count (`state_transform_count`) in materialize result
- [x] Schema validation for duplicate `target` values across transforms
- [ ] Evaluation engine: per-tick eager evaluation in `executeWorldEnginePreparedStep`
- [x] Template variable resolution: `{{actor_state.<target>}}` resolves via existing interpolation (no engine changes required)
