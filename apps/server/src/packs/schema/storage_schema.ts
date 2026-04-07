import { z } from 'zod';

import {
  nonEmptyStringSchema,
  storageFieldTypeSchema,
  storageStrategySchema
} from './common_schema.js';

const storageFieldDefinitionSchema = z
  .object({
    key: nonEmptyStringSchema,
    type: storageFieldTypeSchema,
    required: z.boolean().optional(),
    values: z.array(nonEmptyStringSchema).optional()
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.type === 'enum' && (!value.values || value.values.length === 0)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'enum storage field requires non-empty values'
      });
    }
    if (value.type !== 'enum' && value.values !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'values is only allowed when type=enum'
      });
    }
  });

const storageIndexDefinitionSchema = z
  .array(nonEmptyStringSchema)
  .min(1)
  .superRefine((value, ctx) => {
    const unique = new Set(value);
    if (unique.size !== value.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'storage index fields must not contain duplicates'
      });
    }
  });

const storageProjectionDefinitionSchema = z
  .object({
    key: nonEmptyStringSchema,
    source: nonEmptyStringSchema,
    materialized: z.boolean().optional(),
    visibility: z.enum(['operator', 'public', 'actor_local'])
  })
  .strict();

const storageCollectionDefinitionSchema = z
  .object({
    key: nonEmptyStringSchema,
    kind: z.literal('table'),
    primary_key: nonEmptyStringSchema,
    fields: z.array(storageFieldDefinitionSchema).min(1),
    indexes: z.array(storageIndexDefinitionSchema).optional()
  })
  .strict()
  .superRefine((value, ctx) => {
    const fieldKeys = value.fields.map(field => field.key);
    const uniqueFieldKeys = new Set(fieldKeys);
    if (uniqueFieldKeys.size !== fieldKeys.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'storage collection field keys must be unique'
      });
    }

    if (!uniqueFieldKeys.has(value.primary_key)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `primary_key must reference an existing field: ${value.primary_key}`
      });
    }

    for (const [indexPosition, indexFields] of (value.indexes ?? []).entries()) {
      for (const field of indexFields) {
        if (!uniqueFieldKeys.has(field)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `storage index references unknown field: ${field}`,
            path: ['indexes', indexPosition]
          });
        }
      }
    }
  });

export const worldPackStorageSchema = z
  .object({
    strategy: storageStrategySchema.default('isolated_pack_db'),
    runtime_db_file: nonEmptyStringSchema.default('runtime.sqlite'),
    projection_db_file: nonEmptyStringSchema.optional(),
    engine_owned_collections: z.array(nonEmptyStringSchema).default([]),
    pack_collections: z.array(storageCollectionDefinitionSchema).default([]),
    projections: z.array(storageProjectionDefinitionSchema).default([]),
    install: z
      .object({
        compile_on_activate: z.boolean().optional(),
        allow_pack_collections: z.boolean().optional(),
        allow_raw_sql: z.boolean().optional()
      })
      .strict()
      .default({})
  })
  .strict()
  .superRefine((value, ctx) => {
    const engineOwned = new Set(value.engine_owned_collections);
    const packCollectionKeys = value.pack_collections.map(collection => collection.key);
    const uniquePackCollectionKeys = new Set(packCollectionKeys);

    if (uniquePackCollectionKeys.size !== packCollectionKeys.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'pack collection keys must be unique'
      });
    }

    for (const collectionKey of packCollectionKeys) {
      if (engineOwned.has(collectionKey)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `pack collection must not shadow engine-owned collection: ${collectionKey}`
        });
      }
    }

    if (value.install.allow_raw_sql === true) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'allow_raw_sql=true is not supported in the current framework'
      });
    }
  });

export type WorldPackStorage = z.infer<typeof worldPackStorageSchema>;
export type WorldPackStorageCollectionDefinition = z.infer<typeof storageCollectionDefinitionSchema>;
export type WorldPackStorageFieldDefinition = z.infer<typeof storageFieldDefinitionSchema>;
export type WorldPackStorageProjectionDefinition = z.infer<typeof storageProjectionDefinitionSchema>;
