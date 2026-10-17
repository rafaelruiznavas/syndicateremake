// Movimiento de personas (SPEC §4).

import { DIR_X, DIR_Y, directionTo } from '../core/angles.js';
import { PersonKind } from '../entities/person.js';

/** Velocidad base por nivel de piernas (bits 1–2 de las mejoras): 40/48/56/64 u/ciclo. */
export function legsSpeed(mods) {
  return [40, 48, 56, 64][(mods & 6) >> 1];
}

/** Escala por adrenalina: v·(nivel−neutro)/(255−neutro), o /neutro si está por debajo; 0 si son iguales. */
export function adrenalineScale(v, { neutral, level }) {
  const d = level - neutral;
  if (d === 0) return 0;
  return d < 0 ? Math.trunc((v * d) / neutral) : Math.trunc((v * d) / (255 - neutral));
}

/** Capacidad de carga: 1000 + 10000 por nivel de brazos (bits 3–4). */
export function carryCapacity(mods) {
  return ((mods & 0x18) >> 3) * 10000 + 1000;
}

/** Velocidad efectiva en u/ciclo (SPEC §4). `weight` = suma de pesos de lo que lleva. */
export function effectiveSpeed(person, weight = 0) {
  let base = person.baseSpeed;
  const agentLike = (person.kind & (PersonKind.AGENT | PersonKind.SCRIPTED)) !== 0;   // flags & 0x1002
  if (!agentLike) return Math.max(12, adrenalineScale(base, person.adrenaline));
  const spare = carryCapacity(person.mods) - weight;
  if (spare < 0) base = Math.max(16, Math.trunc((base * (1000 - Math.abs(spare))) / 1000));
  return Math.max(16, adrenalineScale(base, person.adrenaline));
}

/**
 * Intenta un paso de `speed` u en la dirección `dir`. Si el terreno lo acepta (desnivel
 * ≤ 32), mueve a la persona y devuelve true.
 * @param {import('../world/terrain.js').Terrain} terrain
 */
export function tryStep(person, dir, speed, terrain) {
  const nx = person.x + ((DIR_X[dir] * speed) >> 8);
  const ny = person.y + ((DIR_Y[dir] * speed) >> 8);
  const dz = terrain.stepDelta(nx, ny, person.z, false, terrain.walksRoads(person));
  if (dz === null) return false;
  person.x = nx; person.y = ny; person.z += dz; person.lastStepDelta = dz;
  return true;
}

// [DIS] Para los acercamientos simples (perseguir, seguir, ir hacia una persona) se prueban
// direcciones vecinas; la marcha a un punto usa el desvío del original (`systems/detour.js`).
const NEIGHBOURS = [16, -16, 32, -32, 48, -48, 64, -64];

/**
 * Un ciclo de marcha hacia el destino. Devuelve 'arrived', 'moving' o 'blocked'.
 * Con `neighbours`, si el paso directo falla se prueban direcciones vecinas.
 */
export function walkStep(person, terrain, weight = 0, { neighbours = false } = {}) {
  const dest = person.destination;
  const dx = dest.x - person.x, dy = dest.y - person.y;
  const dist = Math.hypot(dx, dy);
  const speed = effectiveSpeed(person, weight);
  person.speed = speed;
  if (dist <= speed) {
    const dz = terrain.stepDelta(dest.x, dest.y, person.z, false, terrain.walksRoads(person));
    if (dz !== null) { person.x = dest.x; person.y = dest.y; person.z += dz; }
    return 'arrived';
  }
  const dir = directionTo(dx, dy);
  person.facing = dir;
  if (tryStep(person, dir, speed, terrain)) return 'moving';
  if (neighbours) for (const d of NEIGHBOURS) if (tryStep(person, (dir + d) & 255, speed, terrain)) return 'moving';
  return 'blocked';
}
