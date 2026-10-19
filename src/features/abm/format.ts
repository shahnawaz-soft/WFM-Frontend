/** Weight display. Units are always named (PRD §4.4); OD-06 decides which system leads. */
export interface Amounts {
  lb: string
  kg: string
  short_tons: string
  tonnes: string
}

const number = (value: string, digits: number) =>
  Number(value).toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits })

export const formatLb = (a: Amounts) => `${number(a.lb, 0)} lb`
export const formatKg = (a: Amounts) => `${number(a.kg, 0)} kg`
export const formatTons = (a: Amounts) => `${number(a.short_tons, 2)} US tons`
export const formatTonnes = (a: Amounts) => `${number(a.tonnes, 2)} t`

/** Short form for tables: "1,040" (lb). */
export const lbValue = (a: Amounts | null | undefined) => (a ? number(a.lb, 0) : null)

/** feet-inches of a millimetre total, e.g. 12192 → 40'-0" (rounded to the inch). */
export function feetInches(mm: string | null): string | null {
  if (mm == null) return null
  const inches = Math.round(Number(mm) / 25.4)
  return `${Math.floor(inches / 12).toLocaleString('en-US')}'-${inches % 12}"`
}

/** Like feetInches, for coordinates and elevations that may be negative. */
export function signedFeetInches(mm: string | null): string | null {
  if (mm == null) return null
  const value = Number(mm)
  const text = feetInches(String(Math.abs(value)))
  return value < 0 && text !== `0'-0"` ? `-${text}` : text
}
