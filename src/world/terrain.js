// Altura del terreno y regla de paso (SPEC §3 y §4).

export const STEP_LIMIT = 32;            // desnivel máximo aceptado por paso
export const WALL = 0x1000;              // altura añadida por un muro (clase 0x0C)
const MAX_Z = 0x601;                     // por encima no hay suelo
/** Clases de carretera (COL01 6–9, 0xB, 0xF): suelo para agentes y para quien ya está en ellas. */
export const ROAD_CLASSES = new Set([6, 7, 8, 9, 0x0b, 0x0f]);

export class Terrain {
  /** @param {import('./map.js').TileMap} map */
  constructor(map) { this.map = map; }

  /**
   * Altura de la superficie del nivel que contiene z en (x, y). 0 = sin superficie.
   * Devuelve null para clases > 0x10, que no aportan superficie (el original mantiene el valor previo).
   * Con `roads = false` (peatones fuera de la calzada, `0x125f0`) las carreteras son muros;
   * con `roads = true` (`0x12400`) son suelo plano.
   */
  surface(x, y, z, roads = true) {
    if (z >= MAX_Z || z < 0) return 0;
    const cls = this.map.classAt(x, y, z);
    if (cls === 0) return 0;
    if (cls > 0x10) return null;
    const base = z & ~0x7f, fx = x & 255, fy = y & 255;
    switch (cls) {
      case 1: return base + ((255 - fy) >> 1);
      case 2: return base + (fy >> 1);
      case 3: return base + (fx >> 1);
      case 4: return base + ((255 - fx) >> 1);
      case 5: case 10: case 13: case 14: return base + 128;
      case 0x0c: return base + WALL;
      case 0x10: return this.objectFloor?.(x, y) ? base + 128 : 0;   // solo si un objeto de la celda hace de suelo
      default: return roads && ROAD_CLASSES.has(cls) ? base + 128 : base + 256;   // sólido: bloquea por la regla de ±32
    }
  }

  /** Suelo bajo los pies partiendo de z: capa superior, actual e inferior; si no hay, cae. */
  ground(x, y, z, roads = true) {
    for (const probe of [z + 127, z - 1, z - 129]) {
      if (probe < 0) return (z - 128) & ~0x7f;
      const h = this.surface(x, y, probe, roads);
      if (h) return h;
    }
    return (z - 129) & ~0x7f;
  }

  /**
   * Desnivel aceptado para pisar (x, y) desde z, o null si el paso está bloqueado (`0x2fd20`;
   * los sondeos del desvío usan un margen de 0x40, `0x2fe70`).
   */
  stepDelta(x, y, z, canDrop = false, roads = true, limit = STEP_LIMIT) {
    const dz = this.ground(x, y, z, roads) - z;
    return dz <= limit && (dz >= -limit || canDrop) ? dz : null;
  }

  /** ¿Puede pisar carretera? Los agentes siempre; los demás solo si ya están en una (`0x2fd20`). */
  walksRoads(p) {
    return p.isAgent || p.class !== 1 || ROAD_CLASSES.has(this.map.classAt(p.x, p.y, p.z - 1)) || this.map.classAt(p.x, p.y, p.z - 1) === 0;
  }

  /**
   * ¿El punto está dentro de geometría sólida? (consulta de obstrucción de las trazas,
   * `0x12150`; aquí con una sola muestra [INF]).
   */
  solidAt(x, y, z) {
    if (z < 0 || z >= 0x600) return false;
    if (!this.map.inside(x >> 8, y >> 8)) return true;
    const h = this.surface(x, y, z);
    return h !== null && h !== 0 && z < h;
  }

  /** Superficie transitable más alta de la columna en (x, y) (para colocar y para el ratón). */
  topSurface(x, y) {
    for (let level = this.map.depth - 1; level >= 0; level--) {
      const h = this.surface(x, y, level * 128);
      if (h && h < level * 128 + 0x100) return h;
    }
    return 0;
  }
}
