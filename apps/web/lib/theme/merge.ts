import type { PartialDeep } from './tokens'

const isPlainObject = (value: unknown): value is Record<string, unknown> => {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export const mergeThemeSection = <T extends object>(base: T, override?: PartialDeep<T>): T => {
  if (!override) {
    return structuredClone(base)
  }

  const output = structuredClone(base) as Record<string, unknown>

  Object.entries(override as Record<string, unknown>).forEach(([key, value]) => {
    const currentValue = output[key]

    if (value === undefined) {
      return
    }

    if (isPlainObject(currentValue) && isPlainObject(value)) {
      output[key] = mergeThemeSection(currentValue, value)
      return
    }

    output[key] = value
  })

  return output as T
}
