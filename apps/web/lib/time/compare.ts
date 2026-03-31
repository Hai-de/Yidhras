import { assertTickString, type TickString } from './tick'

export const compareTickStrings = (left: TickString, right: TickString): number => {
  const normalizedLeft = BigInt(assertTickString(left, 'left tick'))
  const normalizedRight = BigInt(assertTickString(right, 'right tick'))

  if (normalizedLeft === normalizedRight) {
    return 0
  }

  return normalizedLeft > normalizedRight ? 1 : -1
}

export const isTickBefore = (left: TickString, right: TickString): boolean => {
  return compareTickStrings(left, right) < 0
}

export const isTickAfter = (left: TickString, right: TickString): boolean => {
  return compareTickStrings(left, right) > 0
}
