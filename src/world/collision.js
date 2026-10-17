// Colisión entre entidades por cajas alineadas (SPEC §5.3).

/** Semiextensión XY y altura de la caja de una entidad, o null si no colisiona. */
export function collisionBox(e) {
  switch (e.class) {
    case 1: return { half: 0x20, height: 0x100 };
    case 2: return { half: 0x80, height: 0x100 };
    case 4: return e.subtype === 0x0c ? { half: 0x40, height: 0x100 } : null;
    case 5:
      switch (e.subtype) {
        case 0x01: case 0x19: case 0x1a: return { half: 0x40, height: 0x100 };
        case 0x0b: return { half: 0x20, height: 400 };
        case 0x0c: return { half: 0x80, height: 0x180 };
        case 0x16: return { half: 0x40, height: 0x170 };
        case 0x1c: case 0x26: case 0x27: case 0x29: return { half: 0x80, height: 0x100 };
        default: return null;
      }
    default: return null;
  }
}

/**
 * Primera entidad cuya caja solapa con la consulta (centro x,y; base z; extensiones w,d; altura h).
 * Como en el original, la consulta usa la MITAD de su extensión y las celdas recorren la completa.
 * @param {import('./spatial.js').SpatialGrid} grid
 */
export function firstOverlap(grid, self, x, y, z, w, d, h, filter = () => true) {
  if (y - d <= 0) return null;
  const hx = Math.trunc(w / 2), hy = Math.trunc(d / 2);
  for (const e of grid.query(x - w, y - d, x + w, y + d)) {
    if (e === self || e.hidden || !filter(e)) continue;
    const box = collisionBox(e);
    if (!box) continue;
    if (x - hx <= e.x + box.half && e.x - box.half <= x + hx &&
        y - hy <= e.y + box.half && e.y - box.half <= y + hy &&
        z <= e.z + box.height && e.z <= z + h) return e;
  }
  return null;
}
