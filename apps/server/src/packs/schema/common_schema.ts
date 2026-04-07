import { z } from 'zod';

export const nonEmptyStringSchema = z.string().trim().min(1);

export const packReferenceKindSchema = z.enum([
  'holder_of',
  'binding_of',
  'subject_entity',
  'direct_entity',
  'ritual_participant',
  'domain_owner'
]);

export const packEntityKindSchema = z.enum([
  'actor',
  'artifact',
  'mediator',
  'domain',
  'institution',
  'abstract_authority',
  'relay',
  'persona'
]);

export const capabilityCategorySchema = z.enum([
  'perceive',
  'invoke',
  'mutate',
  'bind',
  'govern',
  'override',
  'propagate'
]);

export const authorityGrantTypeSchema = z.enum([
  'intrinsic',
  'mediated',
  'institutional',
  'inherited',
  'ritual',
  'temporary'
]);

export const mediatorKindSchema = z.enum([
  'artifact_vessel',
  'title_seal',
  'contract',
  'ritual_channel',
  'institutional_office',
  'curse_mark'
]);

export const storageStrategySchema = z.enum(['isolated_pack_db']);

export const storageFieldTypeSchema = z.enum([
  'string',
  'number',
  'boolean',
  'tick',
  'json',
  'entity_ref',
  'identity_ref',
  'capability_ref',
  'mediator_ref',
  'authority_ref',
  'enum'
]);

export type PackReferenceKind = z.infer<typeof packReferenceKindSchema>;
export type PackEntityKind = z.infer<typeof packEntityKindSchema>;
export type CapabilityCategory = z.infer<typeof capabilityCategorySchema>;
export type AuthorityGrantType = z.infer<typeof authorityGrantTypeSchema>;
export type MediatorKind = z.infer<typeof mediatorKindSchema>;
export type StorageStrategy = z.infer<typeof storageStrategySchema>;
export type StorageFieldType = z.infer<typeof storageFieldTypeSchema>;
