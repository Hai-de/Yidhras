import { assert, isRecord } from './helpers.js';

export const assertSuccessEnvelopeData = (body: unknown, label: string): Record<string, unknown> => {
  assert(isRecord(body), `${label} should return envelope object`);
  assert(body.success === true, `${label} success should be true`);
  assert(isRecord(body.data), `${label}.data should be object`);
  return body.data as Record<string, unknown>;
};
