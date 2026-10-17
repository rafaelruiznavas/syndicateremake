// Índice espacial: celdas de 256×256 u con las entidades que contienen (SPEC §5.2).

export class SpatialGrid {
  constructor(width = 128, height = 96) {
    this.width = width; this.height = height;
    this.cells = new Map();
  }
  key(x, y) { return ((y >> 8) & 0x7f) * this.width + ((x >> 8) & 0x7f); }
  insert(e) { const k = this.key(e.x, e.y); e.cellKey = k; (this.cells.get(k) ?? this.cells.set(k, new Set()).get(k)).add(e); }
  remove(e) { if (e.cellKey !== undefined) this.cells.get(e.cellKey)?.delete(e); e.cellKey = undefined; }
  move(e) { const k = this.key(e.x, e.y); if (k !== e.cellKey) { this.remove(e); this.insert(e); } }
  /** Entidades de las celdas que cubre [x0,x1]×[y0,y1]. */
  *query(x0, y0, x1, y1) {
    for (let cy = y0 & ~0xff; cy <= (y1 & ~0xff); cy += 256)
      for (let cx = x0 & ~0xff; cx <= (x1 & ~0xff); cx += 256) {
        const set = this.cells.get(this.key(cx, cy));
        if (set) yield* set;
      }
  }
}
