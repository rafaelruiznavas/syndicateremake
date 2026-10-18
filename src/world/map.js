// Mapa de casillas: 128×96 columnas de 12 niveles; cada nivel guarda un id de tile y
// cada tile tiene una clase de superficie (COL01).

import { TILE, LEVEL, MAP_WIDTH, MAP_HEIGHT, MAP_DEPTH } from '../core/constants.js';

export class TileMap {
  /** @param {{width,height,depth,tiles:string}} data  @param {number[]} classes */
  constructor(data, classes) {
    this.width = data.width; this.height = data.height; this.depth = data.depth;
    if (this.width !== MAP_WIDTH || this.height !== MAP_HEIGHT || this.depth !== MAP_DEPTH) throw new Error('Mapa con dimensiones inesperadas');
    const bin = atob(data.tiles);
    this.tiles = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) this.tiles[i] = bin.charCodeAt(i);
    this.classes = Uint8Array.from(classes);
  }
  inside(tx, ty) { return tx >= 0 && ty >= 0 && tx < this.width && ty < this.height; }
  tileAt(tx, ty, tz) {
    if (!this.inside(tx, ty) || tz < 0 || tz >= this.depth) return 0;
    return this.tiles[(ty * this.width + tx) * this.depth + tz];
  }
  /** Clase de superficie en coordenadas del mundo (x, y en u; z en u). El eje Y se envuelve en 0x6000. */
  classAt(x, y, z) {
    const tx = x >> 8, ty = (((y % 0x6000) + 0x6000) % 0x6000) >> 8, tz = z >> 7;
    const tile = this.tileAt(tx, ty, tz);
    return tile ? this.classes[tile] : 0;
  }
  /** Tile bajo los pies (nivel de z − 1), con el eje Y envuelto como `classAt`. */
  tileUnder(x, y, z) {
    return this.tileAt(x >> 8, (((y % 0x6000) + 0x6000) % 0x6000) >> 8, (z - 1) >> 7);
  }
  static worldSize() { return { x: MAP_WIDTH * TILE, y: MAP_HEIGHT * TILE, z: MAP_DEPTH * LEVEL }; }
}
