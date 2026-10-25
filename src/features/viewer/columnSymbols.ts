/** Plain names for the column symbols found on plans ("I", square, circle). */
export const COLUMN_SHAPES: Record<string, string> = {
  wide_flange: 'Wide-flange column (I)',
  square_tube: 'Square tube column',
  round_tube: 'Round tube column',
  grid_mark: 'Column (the mark drawn at the grid crossings)',
  similar: 'Column (found like one a person pointed at)',
}

/** e.g. 'Square tube column, drawn about 5"' / 'Wide-flange column (I), drawn about 13.6" × 12.5"',
 *  led by its section when a label is tied to it ('W12X120 · Wide-flange column (I), …'). */
export function describeColumn(c: { shape?: string | null; depth_in: number; flange_in: number; designation?: string | null }): string {
  const name = COLUMN_SHAPES[c.shape ?? 'wide_flange'] ?? 'Column'
  const drawn =
    c.shape === 'grid_mark' || c.shape === 'similar'
      ? c.depth_in
        ? `${name}, drawn about ${c.depth_in}" × ${c.flange_in}"`
        : name
      : c.shape === 'square_tube' || c.shape === 'round_tube'
        ? `${name}, drawn about ${c.depth_in}"${c.shape === 'round_tube' ? ' diameter' : ''}`
        : `${name}, drawn about ${c.depth_in}" × ${c.flange_in}"`
  return c.designation ? `${c.designation} · ${drawn}` : drawn
}

/** "23 square, 20 round, 1 I" for the legend. */
export function columnBreakdown(columns: { shape?: string | null }[]): string {
  const count = (shape: string) => columns.filter((c) => (c.shape ?? 'wide_flange') === shape).length
  return [
    [count('wide_flange'), 'I'],
    [count('square_tube'), 'square'],
    [count('round_tube'), 'round'],
    [count('grid_mark'), 'at grid crossings'],
    [count('similar'), 'found like one pointed at'],
  ]
    .filter(([n]) => (n as number) > 0)
    .map(([n, label]) => `${n} ${label}`)
    .join(', ')
}
