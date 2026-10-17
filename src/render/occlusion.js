// Oclusión de las entidades por el mapa (SPEC §5.5). El original (`0x1d450`) pinta primero
// el mapa entero, luego las entidades ordenadas por x+y y, tras cada una, vuelve a pintar
// encima de su rectángulo los bloques del mapa que quedan delante (`0x43806`, `0x43933`).
// Aquí «delante» se decide con cajas: un bloque tapa a la entidad si está por completo más
// cerca del observador en algún eje (x, y o z) y la entidad no lo está en ninguno [DIS].

import { TILE, LEVEL } from '../core/constants.js';
import { Person } from '../entities/person.js';
import { Vehicle } from '../entities/entity.js';

/** Semilado en x/y y altura de la caja de cada tipo de entidad (u). [DIS] */
const BOX = { person: [0x20, 0x100], vehicle: [0x80, 0xc0], static: [0x40, 0x200], other: [0x20, 0x80] };

/** Subtipos de estáticos que ordenan por (x−0x80)+(y−0x80) (`0x1d450`). */
const STATIC_BACK = new Set([10, 0x12, 0x13, 0x14, 0x15, 0x20, 0x21, 0x22, 0x23, 0x24, 0x25]);
const STATIC_CLASS = 5;

/** Clave de orden de pintado (`0x1d450`): x+y, adelantada 0x100 en algunos estáticos. */
export function paintKey(e) {
  if (e.class === STATIC_CLASS && STATIC_BACK.has(e.subtype)) return e.x - 0x80 + e.y - 0x80;
  return e.x + e.y;
}

/** Caja de la entidad en el mundo: [x0, x1, y0, y1, z0, z1]. */
export function entityBox(e) {
  const [r, h] = e instanceof Person ? BOX.person : e instanceof Vehicle ? BOX.vehicle : e.class === STATIC_CLASS ? BOX.static : BOX.other;
  return [e.x - r, e.x + r, e.y - r, e.y + r, e.z, e.z + h];
}

/** ¿El bloque (tx, ty, tz) está delante de la caja? Cerca del observador = mayor x, y o z. */
export function blockInFront(tx, ty, tz, [x0, x1, y0, y1, z0, z1]) {
  const bx0 = tx * TILE, by0 = ty * TILE, bz0 = tz * LEVEL;
  const bx1 = bx0 + TILE, by1 = by0 + TILE, bz1 = bz0 + LEVEL;
  const blockNearer = bx0 >= x1 || by0 >= y1 || bz0 >= z1;
  const entityNearer = x0 >= bx1 || y0 >= by1 || z0 >= bz1;
  return blockNearer && !entityNearer;
}
