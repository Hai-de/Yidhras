import { z } from 'zod'

export const bigIntStringSchema = z.string().regex(/^-?\d+$/, 'must be an integer string')

export const nonNegativeBigIntStringSchema = z
  .string()
  .regex(/^\d+$/, 'must be a non-negative integer string')

export const positiveBigIntStringSchema = z
  .string()
  .regex(/^[1-9]\d*$/, 'must be a positive integer string')
