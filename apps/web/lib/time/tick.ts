export type TickString = string

const TICK_STRING_PATTERN = /^\d+$/

export const ZERO_TICK: TickString = '0'

export const isTickString = (value: unknown): value is TickString => {
  return typeof value === 'string' && TICK_STRING_PATTERN.test(value)
}

export const assertTickString = (value: unknown, fieldName = 'tick'): TickString => {
  if (!isTickString(value)) {
    throw new TypeError(`${fieldName} must be a non-negative integer string`)
  }

  return value
}

export const toTickString = (value: TickString | number | bigint, fieldName = 'tick'): TickString => {
  if (typeof value === 'string') {
    return assertTickString(value, fieldName)
  }

  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new TypeError(`${fieldName} must be a non-negative safe integer`)
    }

    return String(value)
  }

  if (value < 0n) {
    throw new TypeError(`${fieldName} must be a non-negative bigint`)
  }

  return value.toString()
}
