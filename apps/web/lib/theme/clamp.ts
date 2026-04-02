const NUMERIC_LENGTH_PATTERN = /^(-?\d+(?:\.\d+)?)(px)$/

const clampPx = (value: string, min: number, max: number, fallback: string): string => {
  const match = value.trim().match(NUMERIC_LENGTH_PATTERN)
  if (!match) {
    return fallback
  }

  const numericValue = Number(match[1])
  if (Number.isNaN(numericValue)) {
    return fallback
  }

  return `${Math.min(Math.max(numericValue, min), max)}px`
}

export const clampAppMinWidth = (value: string, fallback: string): string => {
  return clampPx(value, 960, 1920, fallback)
}

export const clampShellRailWidth = (value: string, fallback: string): string => {
  return clampPx(value, 56, 128, fallback)
}

export const clampShellSidebarWidth = (value: string, fallback: string): string => {
  return clampPx(value, 240, 480, fallback)
}

export const clampShellDockMinHeight = (value: string, fallback: string): string => {
  return clampPx(value, 120, 320, fallback)
}

export const clampShellDockDefaultHeight = (value: string, fallback: string): string => {
  return clampPx(value, 160, 480, fallback)
}

export const clampShellDockMaxHeight = (value: string, fallback: string): string => {
  return clampPx(value, 240, 720, fallback)
}
