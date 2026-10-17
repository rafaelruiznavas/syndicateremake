// Escáner del panel (SPEC §12.3, `0x1bec0`): vista cenital del agente seleccionado con el
// suelo por clases, las personas como puntos, los vehículos, una cruz sobre el agente y la
// baliza del objetivo pendiente.

import { PersonKind } from '../entities/person.js';
import { W } from '../systems/weapons.js';

export const SCANNER = { x: 0, y: 0x110, w: 128, h: 128 };
const ZOOM = 8, ZOOM_WITH_SCANNER = 4;
const MAP_W = 0x80, MAP_H = 0x60;
const MAX_PER_TILE = 300;
const BEACON_SOUND = 0x11;

/** Color de la casilla por la clase de su bloque más bajo; las demás clases no se pintan. */
const GROUND_COLOR = new Map([
  [1, 15], [2, 15], [3, 15], [4, 15], [0x0d, 15],
  [5, 7], [0x0e, 7],
  [6, 10], [7, 10], [8, 10], [9, 10], [0x0b, 10], [0x0f, 10],
  [0x0a, 0],
]);
const C = Object.freeze({ GUARD: 4, POLICE: 15, OWN: 0x0b, RIVAL: 0x0e, VEHICLE: 0x0c, CIVILIAN: 0x0c, ITEM: 4, CROSS: 0, RING: 0x0c, POINT: 0x0e });
const BLIP_SIZE = 3;
/** Semianchura de cada fila, desde el centro, de los puntos de tamaño 2–8 (`0x1b5d0`). */
export const BLIP_ROWS = { 2: [1, 0], 3: [2, 2, 1], 4: [3, 3, 2, 1], 5: [4, 4, 3, 3, 1], 6: [5, 5, 5, 4, 4, 2], 7: [6, 6, 6, 5, 5, 4, 2], 8: [7, 7, 7, 6, 6, 5, 4, 2] };
/** Objetivos con baliza sobre una entidad; 0x10 es un punto. */
const ENTITY_BEACON = new Set([1, 2, 3, 5, 0x0e, 0x0f]);
const POINT_BEACON = 0x10;

export class Scanner {
  constructor() {
    this.ring = 0;               // radio de la baliza (`0x53ef4`)
    this.showAll = false;        // opción `0x5e395`: civiles y objetos [DES] cómo se activa
  }

  /** 8 px por casilla, o 4 si algún agente de la escuadra lleva un escáner (`0x2d0e0`). */
  static zoom(world) {
    return world.squad.some((a) => !a.dead && a.items.some((it) => it.weapon === W.SCANNER)) ? ZOOM_WITH_SCANNER : ZOOM;
  }

  /**
   * Contenido del escáner centrado en `focus`, en coordenadas relativas al recuadro (0..127).
   * @returns {{cells:{x,y,size,color}[], blips:{x,y,color}[], squares:{x,y,size,color}[], cross:{x,y}|null}}
   */
  layout(world, focus, zoom) {
    const half = 0x4000 / zoom, perTile = 0x100 / zoom, span = 0x80 / zoom;
    const ox = Math.trunc(focus.x - half), oy = Math.trunc(focus.y - half);
    const col0 = ox >> 8, row0 = oy >> 8, subX = Math.trunc((ox & 0xff) / perTile), subY = Math.trunc((oy & 0xff) / perTile);
    const screenX = (col) => (col - col0) * zoom - subX, screenY = (row) => (row - row0) * zoom - subY;
    const out = { cells: [], blips: [], squares: [], cross: null };
    const map = world.map;
    for (let row = row0; row <= row0 + span + 1 && row < MAP_H; row++) {
      if (row < 0) continue;
      for (let col = col0; col <= col0 + span + 1 && col < MAP_W; col++) {
        if (col < 0) continue;
        const color = GROUND_COLOR.get(map.classes[map.tileAt(col, row, 0)]);
        if (color !== undefined) out.cells.push({ x: screenX(col), y: screenY(row), size: zoom, color });
      }
    }
    const shown = (e) => !e.removed && (!e.hidden || e.isPlayerSquad);
    for (let row = Math.max(0, row0); row <= row0 + span + 1 && row < MAP_H; row++) {
      for (let col = Math.max(0, col0); col <= col0 + span + 1 && col < MAP_W; col++) {
        let n = 0;
        for (const e of world.grid.query(col << 8, row << 8, col << 8, row << 8)) {
          if (++n > MAX_PER_TILE) break;
          if (!shown(e)) continue;
          const x = ((((e.x & 0xff) * zoom) >> 8) + screenX(col)), y = ((((e.y & 0xff) * zoom) >> 8) + screenY(row));
          if (e.class === 1) this.#person(world, e, x, y, out);
          else if (e.class === 2) { const s = Math.max(1, zoom >> 1); out.squares.push({ x: x - (s >> 1), y: y - (s >> 1), size: s, color: C.VEHICLE }); }
          else if (e.class === 4 && this.showAll && !e.owner) out.squares.push({ x: x - 1, y: y - 1, size: 2, color: C.ITEM });
          if (e === focus) out.cross = { x, y };
        }
      }
    }
    // Los agentes del jugador dentro de un vehículo no están en la rejilla.
    for (const a of world.squad) {
      if (!a.vehicle || a.dead) continue;
      const x = Math.trunc(((a.x - ox) * zoom) / 0x100), y = Math.trunc(((a.y - oy) * zoom) / 0x100);
      out.blips.push({ x, y, color: C.OWN });
      if (a === focus) out.cross = { x, y };
    }
    return out;
  }

  #person(world, p, x, y, out) {
    const leader = p.following;
    let owner = p.isAgent ? p.group : -1;
    if (!leader && p.is(PersonKind.GUARD)) { out.blips.push({ x, y, color: C.GUARD }); return; }
    if (!leader && p.is(PersonKind.POLICE)) { out.blips.push({ x, y, color: C.POLICE }); return; }
    if (leader) owner = leader.isAgent ? leader.group : -1;
    if (owner === -1) {
      if (this.showAll) out.squares.push({ x: x - 1, y: y - 1, size: 2, color: C.CIVILIAN });
      return;
    }
    out.blips.push({ x, y, color: owner === 0 ? C.OWN : C.RIVAL });
  }

  /**
   * Baliza (`0x1bec0`, final): círculo que crece z por fotograma desde el blanco del primer
   * objetivo pendiente; al pasar del centro vuelve a 0 y suena 0x11. Devuelve los círculos.
   */
  beacon(world, focus, zoom, blink) {
    const o = world.objectives;
    if (!o.running) return [];
    const target = o.list.find((q) => !q.done && q.type !== 0);
    if (!target) return [];
    let tx, ty;
    if (ENTITY_BEACON.has(target.type) && target.entity) { tx = target.entity.x; ty = target.entity.y; }
    else if (target.type === POINT_BEACON) { tx = target.x; ty = target.y; }
    else return [];
    const perTile = 0x100 / zoom;
    const cx = Math.trunc((tx - focus.x) / perTile) + 0x40, cy = Math.trunc((ty - focus.y) / perTile) + 0x40;
    const reach = Math.floor(Math.hypot(0x40 - cx, 0x40 - cy)) + zoom * 4;
    this.ring += zoom;
    const inside = cx >= 0 && cx < 0x80 && cy >= 0 && cy < 0x80;
    if (target.type === POINT_BEACON) {
      if (this.ring > reach) { this.ring = 3; if (!inside) world.events.emit('sound', { id: BEACON_SOUND }); }
      if (inside) return [{ x: cx, y: cy, r: zoom * 3, color: C.POINT - 8 * (blink ? 1 : 0) }];
      return [{ x: cx, y: cy, r: this.ring, color: C.RING }];
    }
    if (this.ring > reach) { this.ring = 0; world.events.emit('sound', { id: BEACON_SOUND }); }
    return [{ x: cx, y: cy, r: this.ring, color: C.RING }];
  }
}

/** Píxeles de un círculo de radio r (punto medio, `0x1bbd0`). */
export function circlePoints(r) {
  const pts = [];
  let x = 0, y = r, d = 3 - 2 * r;
  while (x <= y) {
    for (const [a, b] of [[x, y], [y, x]]) pts.push([a, b], [-a, b], [a, -b], [-a, -b]);
    if (d < 0) d += 4 * x + 6; else { d += 4 * (x - y) + 10; y--; }
    x++;
  }
  return pts;
}
