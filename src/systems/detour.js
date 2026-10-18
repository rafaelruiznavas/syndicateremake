// Desvío ante obstáculos (SPEC §7.5): al bloquearse la marcha se simula seguir la pared
// por la izquierda y por la derecha y se elige el lado que antes acerca al destino. Después
// la persona sigue la pared (estados 0xE y 0xF) hasta que deja de hacer falta.

import { DIR_X, DIR_Y } from '../core/angles.js';
import { S } from '../entities/person.js';

export const DETOUR_TIMER = 500;
const PROBE_SPEED = 0x80, SIM_STEPS = 32, TRIES = 4;
const SIM_STEP_LIMIT = 0x40;            // `0x2fe70`: las copias aceptan desniveles de ±0x40
export const WALL_DELTA = Object.freeze({ [S.WALL_LEFT]: -0x40, [S.WALL_RIGHT]: 0x40 });

const sameTile = (a, b) => (a.x >> 8) === (b.x >> 8) && (a.y >> 8) === (b.y >> 8);
const dist = (a, b) => Math.floor(Math.hypot(b.x - a.x, b.y - a.y));

export class Detours {
  /** @param {import('../world/world.js').World} world */
  constructor(world) { this.world = world; this.used = false; }

  /** Solo una persona por ciclo calcula un desvío (bandera `0x55300`). */
  newCycle() { this.used = false; }

  /**
   * ¿Se puede dar un paso de `speed` en la dirección `h` desde la posición de `body`? Con
   * `wide` (las copias simuladas y el sondeo de 0x80, `0x2fe70`) el margen es ±0x40.
   */
  free(body, h, speed, wide = !!body.copy) {
    const nx = body.x + ((DIR_X[h] * speed) >> 8), ny = body.y + ((DIR_Y[h] * speed) >> 8);
    return this.#delta(body, nx, ny, wide) !== null;
  }

  #delta(body, nx, ny, wide = !!body.copy) {
    const t = this.world.terrain, roads = body.roads ?? t.walksRoads(body);
    return wide ? t.stepDelta(nx, ny, body.z, false, roads, SIM_STEP_LIMIT) : t.stepDelta(nx, ny, body.z, !!body.canDrop, roads);
  }

  /** Gira hacia la pared (`h + delta`) y, si no se puede, va enderezando (hasta 4 pruebas). */
  turn(body, delta, speed) {
    let h = (body.facing + delta) & 255;
    for (let i = 0; i < TRIES; i++) {
      if (this.free(body, h, speed)) break;
      h = (h - delta) & 255;
    }
    return h;
  }

  /**
   * Calcula el desvío (`0x307b0`). Devuelve false si este ciclo ya lo ha usado otra persona.
   * Deja a la persona en el estado 0xE o 0xF, o le da un paso de tanteo si choca en diagonal.
   */
  start(p, timer = DETOUR_TIMER) {
    if (this.used || !p.destination) return false;
    this.used = true;
    const dest = p.destination, speed = p.speed || 16;
    // Desde el eje a la izquierda de la orientación se busca el primer eje bloqueado: la pared
    // (`a` con el sondeo de 0x80, `b` con el paso de su velocidad; `0x2fff0`, `0x2ff80`).
    const q = ((((p.facing + 0x20) >> 6) * 0x40) - 0x40) & 255;
    let a = q;
    for (let i = 0; i < TRIES && this.free(p, a, PROBE_SPEED, true); i++) a = (a + 0x40) & 255;
    let b = q, wall = false;
    for (let i = 0; i < TRIES; i++) {
      if (!this.free(p, b, speed)) { wall = true; break; }
      b = (b + 0x40) & 255;
    }
    if (!wall) { this.#nudge(p, a, speed); return true; }

    const startDist = dist(p, dest);
    p.detour = { heading: b, tries: TRIES, startDist };
    p.timer = timer;
    const side = this.#simulate(p, a, dest, startDist);
    p.state = side;
    p.facing = (b + (side === S.WALL_LEFT ? 0x40 : -0x40)) & 255;
    return true;
  }

  /** Simula las dos copias 32 pasos de 0x80 u y decide el lado. */
  #simulate(p, a, dest, startDist) {
    const roads = this.world.terrain.walksRoads(p);
    const left = { x: p.x, y: p.y, z: p.z, facing: (a + 0x40) & 255, copy: true, roads, best: startDist, at: 0 };
    const right = { x: p.x, y: p.y, z: p.z, facing: (a - 0x40) & 255, copy: true, roads, best: startDist, at: 0 };
    for (let k = 0; k < SIM_STEPS; k++) {
      for (const [copy, delta, side] of [[left, -0x40, S.WALL_LEFT], [right, 0x40, S.WALL_RIGHT]]) {
        copy.facing = this.turn(copy, delta, PROBE_SPEED);
        if (sameTile(copy, dest)) return side;
        this.#step(copy);
        const d = dist(copy, dest);
        if (d < copy.best) { copy.best = d; copy.at = k; }
      }
    }
    // Ninguna llega: gana la que mejora antes, salvo que la otra mejore bastante más.
    if (right.at === 0) return S.WALL_LEFT;
    if (left.at === 0) return S.WALL_RIGHT;
    if (right.at <= left.at) {
      return left.best < right.best && (left.at - right.at) * 0x80 < right.best - left.best ? S.WALL_LEFT : S.WALL_RIGHT;
    }
    return right.best < left.best && (right.at - left.at) * 0x80 < left.best - right.best ? S.WALL_RIGHT : S.WALL_LEFT;
  }

  #step(copy) {
    const nx = copy.x + (DIR_X[copy.facing] >> 1), ny = copy.y + (DIR_Y[copy.facing] >> 1);
    const dz = this.#delta(copy, nx, ny);
    copy.x = nx; copy.y = ny;
    if (dz !== null) copy.z += dz;
  }

  /**
   * Desvío corto (`0x306d0`, al huir): la pared es el primer eje bloqueado desde la izquierda
   * de la orientación; se gira 90° hacia el lado al que ya miraba y se sigue la pared `timer`
   * ciclos. Sin destino propio, se usa `dest` (el punto de huida) [INF].
   */
  quick(p, timer, dest) {
    if (!p.destination) p.destination = dest;
    let wall = ((((p.facing + 0x20) >> 6) * 0x40) - 0x40) & 255;
    for (let i = 0; i < TRIES && this.free(p, wall, p.speed || 16); i++) wall = (wall + 0x40) & 255;
    p.detour = { heading: wall, tries: TRIES, startDist: dist(p, p.destination) };
    p.timer = timer;
    const turnLeft = wall === 0 ? (p.facing > 0 && p.facing < 0x80) : p.facing > wall;
    p.nextState = p.state;
    p.state = turnLeft ? S.WALL_LEFT : S.WALL_RIGHT;
    p.facing = (wall + (turnLeft ? 0x40 : -0x40)) & 255;
  }

  /** Ningún eje bloqueado (choca en diagonal): busca la diagonal bloqueada y sale por un eje vecino al azar. */
  #nudge(p, a, speed) {
    let c = (a + 0x20) & 255;
    for (let i = 0; i < TRIES && this.free(p, c, speed); i++) c = (c + 0x40) & 255;
    c = (c + (this.world.rng.int(2) * 2 - 1) * 0x20) & 255;
    p.facing = c;
    const nx = p.x + ((DIR_X[c] * speed) >> 8), ny = p.y + ((DIR_Y[c] * speed) >> 8);
    const dz = this.#delta(p, nx, ny);
    if (dz !== null) { p.x = nx; p.y = ny; p.z += dz; this.world.grid.move(p); }
  }

  /**
   * Un ciclo siguiendo la pared (`0x30cc0`). Devuelve false cuando el desvío ya no hace
   * falta (más cerca que al empezar sin ir hacia el obstáculo), se agota el tiempo o los giros.
   */
  follow(p, delta) {
    const d = p.detour;
    if (!d || !p.destination) return false;
    const h = this.turn(p, delta, p.speed || 16);
    const closer = dist(p, p.destination) < d.startDist && h !== ((d.heading - delta) & 255) && h !== ((d.heading + 0x80) & 255);
    if (closer) return false;
    if (--p.timer === 0 || d.tries === 0) return false;
    d.tries = h === p.facing ? TRIES : d.tries - 1;
    p.facing = h;
    return true;
  }

  static arrived(p) { return !p.destination || sameTile(p, p.destination); }
}
