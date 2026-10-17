// Armas: activación del disparo, emisión de trazas por ciclo y elección automática
// (SPEC §6.1, §6.1b, §6.1c).

import { DIR_X, DIR_Y, directionTo } from '../core/angles.js';
import { S } from '../entities/person.js';

export const W = Object.freeze({
  PERSUADERTRON: 1, PISTOL: 2, GAUSS: 3, SHOTGUN: 4, UZI: 5, MINIGUN: 6, LASER: 7, FLAMER: 8, LONG_RANGE: 9,
  SCANNER: 10, MEDIKIT: 11, TIME_BOMB: 12, ACCESS_CARD: 13, AUTO_MAPPER: 16, ENERGY_SHIELD: 17,
});

/** Armas que disparan trazas instantáneas y cuántas por activación (SPEC §6.1b). */
const BULLET_TRACES = { [W.PISTOL]: 1, [W.SHOTGUN]: 7, [W.UZI]: 1, [W.MINIGUN]: 5, [W.LONG_RANGE]: 1 };

/** Rango de preferencia y distancia máxima para la elección automática (SPEC §6.1c, `0x3a390`). */
const CHOICE = [
  [W.GAUSS, 1, 0x1400], [W.PISTOL, 4, 0x500], [W.SHOTGUN, 5, 0x400], [W.LONG_RANGE, 5, 0x1800],
  [W.FLAMER, 6, 0x200], [W.UZI, 7, 0x700], [W.MINIGUN, 8, 0x900], [W.LASER, 9, 0x1000],
];

const FLASH_ANIM = 0x17e;

/** Sonido de disparo por arma (`0x3a970`, SPEC §13.1). */
export const FIRE_SOUND = Object.freeze({
  [W.PISTOL]: 2, [W.GAUSS]: 0x16, [W.SHOTGUN]: 1, [W.UZI]: 0xb, [W.MINIGUN]: 0xd, [W.LASER]: 4, [W.FLAMER]: 5, [W.LONG_RANGE]: 0xc,
});

export class Weapons {
  /** @param {object[]} catalog weapons.json */
  constructor(catalog) { this.catalog = catalog; }
  info(type) { return this.catalog[type - 1]; }
  range(type) { return this.info(type)?.range ?? 0; }
  /** Recurso de un arma llena: M (0 aún dispara; −1 agotada). */
  fullAmmo(type) { return this.info(type)?.maxAmmo ?? 0; }

  /** Mejor arma que lleva la persona para una distancia d, o la equipada si tiene recurso. */
  choose(person, d) {
    let best = null, rank = 0;
    for (const it of person.items) {
      if (it.ammo < 0) continue;
      const c = CHOICE.find(([t]) => t === it.weapon);
      if (c && c[1] > rank && d <= c[2]) { best = it; rank = c[1]; }
    }
    if (best) return best;
    return person.equipped && person.equipped.ammo >= 0 ? person.equipped : null;
  }

  /** Orden de disparar a (tx, ty, tz) (SPEC §6.1b punto 1, `0x31ec0`). */
  activate(person, tx, ty, tz) {
    const it = person.equipped;
    if (!it || it.ammo < 0) return false;
    const dx = tx - person.x, dy = ty - person.y;
    person.facing = directionTo(dx, dy);
    person.pitch = directionTo(tz - (person.z + 0x80), Math.floor(Math.hypot(dx, dy)));
    person.state = S.FIRING;
    person.fireWindow = this.info(it.weapon)?.activationWindow ?? 0;
    return true;
  }

  /** ¿Es automática (sigue disparando mientras dura la orden)? */
  isAutomatic(it) { return (this.info(it?.weapon)?.fireMode ?? 0) === 1; }

  /**
   * Emisión de un ciclo para todos los portadores con ventana L > 0 (SPEC §6.1b punto 2).
   * Las trazas de bala se resuelven en el acto (estado 0x1E del original).
   */
  emit(world) {
    for (const p of world.people) {
      const it = p.equipped;
      if (!it || p.dead || p.fireWindow === 0 || it.ammo < 0) continue;
      const traces = BULLET_TRACES[it.weapon];
      if (FIRE_SOUND[it.weapon]) world.events.emit('sound', { id: FIRE_SOUND[it.weapon], at: p });
      if (traces) {
        const s = 15 - p.perception.scale(15);
        const jitter = () => (s > 0 ? world.rng.int(s) - (s >> 1) : 0);
        if (it.weapon === W.SHOTGUN) it.ammo--;
        for (let k = 0; k < traces; k++) {
          const spread = it.weapon === W.SHOTGUN ? (k - 3) * 4 : 0;     // [INF] abertura −3..3
          this.trace(world, p, (p.facing + spread + jitter()) & 255, p.pitch, this.range(it.weapon) >> 7);
          if (it.weapon !== W.SHOTGUN) it.ammo--;
        }
      } else if (it.weapon === W.PERSUADERTRON) {
        world.persuasion.pulse(world, p);
      }
    }
  }

  /** Traza de bala: avanza `steps` pasos de 128 desde z+0x80 hasta terreno o persona. */
  trace(world, shooter, dir, pitch, steps) {
    if (shooter.isPlayerSquad) world.stats.shots++;
    let x = shooter.x, y = shooter.y, z = shooter.z + 0x80;
    const h = (DIR_Y[pitch] * 128) >> 8, dz = (DIR_X[pitch] * 128) >> 8;
    let hit = null;
    for (let i = 0; i < steps; i++) {
      const nx = x + ((DIR_X[dir] * h) >> 8), ny = y + ((DIR_Y[dir] * h) >> 8), nz = z + dz;
      if (world.terrain.solidAt(nx, ny, nz)) break;
      x = nx; y = ny; z = nz;
      hit = world.damage.bulletHit(world, shooter, x, y, z);
      if (hit) { if (shooter.isPlayerSquad) world.stats.hits++; break; }
    }
    world.spawnEffect(x + 0x20 - world.rng.int(0x40), y + 0x20 - world.rng.int(0x40), z, FLASH_ANIM);
    return hit;
  }
}

