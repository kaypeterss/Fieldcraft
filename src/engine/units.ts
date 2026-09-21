export const MILLIMETERS_PER_INCH = 25.4

export function millimetersToInches(millimeters: number): number {
  return millimeters / MILLIMETERS_PER_INCH
}

export function inchesToMillimeters(inches: number): number {
  return inches * MILLIMETERS_PER_INCH
}

export function formatInches(inches: number): string {
  return `${inches.toFixed(2)}\u2033`
}
