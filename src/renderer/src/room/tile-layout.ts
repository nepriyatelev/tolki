/** The shape of a tile: a little wider than tall, like a camera picture. */
export const TILE_ASPECT = 16 / 10

export interface TileLayout {
  columns: number
  /** px; the height follows from TILE_ASPECT. */
  width: number
}

/**
 * The grid that fills the space with the biggest tiles (#110, as in Meet and Teams): every
 * column count is tried, and the one whose tiles come out largest wins. One person — one big
 * tile; four — 2×2 on a wide window; fifteen — as many as fit.
 */
export function tileLayout(
  count: number,
  width: number,
  height: number,
  gap: number,
  aspect: number = TILE_ASPECT,
): TileLayout {
  let best: TileLayout = { columns: 1, width: 0 }
  if (count <= 0 || width <= 0 || height <= 0) return best
  for (let columns = 1; columns <= count; columns++) {
    const rows = Math.ceil(count / columns)
    const byWidth = (width - gap * (columns - 1)) / columns
    const byHeight = ((height - gap * (rows - 1)) / rows) * aspect
    const tile = Math.floor(Math.min(byWidth, byHeight))
    if (tile > best.width) best = { columns, width: tile }
  }
  return best
}
