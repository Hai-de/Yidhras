import { assertTickString, type TickString } from './tick'

export const padTickString = (tick: TickString, minLength = 9): string => {
  const normalizedTick = assertTickString(tick)
  return normalizedTick.padStart(minLength, '0')
}

export const formatTickLabel = (tick: TickString): string => {
  return assertTickString(tick)
}
