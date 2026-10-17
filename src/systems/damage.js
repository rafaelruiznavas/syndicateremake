// Daño, resistencia, muertes y bajas (SPEC §6.2, §6.5).

import { Person, PersonKind, Ev, S } from '../entities/person.js';
import { W } from './weapons.js';
import { Vehicle } from '../entities/entity.js';

/** Nivel de resistencia: pecho (bits 5–6); los objetivos marcados no tienen (n = 0). */
export function resistance(p) {
  return p.objectiveMarked ? 0 : (p.mods & 0x60) >> 5;
}

/** Daño de los manejadores por evento y nivel n (SPEC §6.2). null = sin resta extra; 'kill' = salud a −1. */
const EVENT_DAMAGE = {
  [S.HIT_EXPLOSION]: ['kill', 'kill', 8, 4],
  [S.HIT_FIRE]: ['kill', 8, 4, 2],
  [S.HIT_BULLET]: [null, null, null, null],
  [S.HIT_OTHER]: ['kill', 'kill', 8, 4],
  [S.HIT_LASER]: ['kill', 'kill', 8, 4],
};

export class Damage {
  /**
   * Muestra de una traza de bala en (x, y, z): caja de 0x80×0x80×0x100 con base en z−0x80.
   * Afecta a todas las personas y vehículos solapados (como `0x13870`) y devuelve el último.
   */
  bulletHit(world, shooter, x, y, z) {
    let last = null;
    const half = 0x40, base = z - 0x80;
    for (const e of world.grid.query(x - 0x100, y - 0x100, x + 0x100, y + 0x100)) {
      if (e instanceof Vehicle) { if (this.vehicleHit(e, shooter, x, y, base)) last = e; continue; }
      if (!(e instanceof Person) || e === shooter || e.hidden || e.corpse) continue;
      if (Math.abs(e.x - x) > half + 0x20 || Math.abs(e.y - y) > half + 0x20) continue;
      if (base > e.z + 0x100 || e.z > base + 0x100) continue;
      if (this.shielded(e)) { last = e; continue; }
      if (!this.admits(world, e)) continue;
      e.health -= 1;
      e.events |= Ev.BULLET;
      e.eventSource = shooter;
      last = e;
    }
    return last;
  }

  /** Bala contra vehículo (±0x80, altura 0x100): −1 de resistencia y evento de bala, salvo si dispara su conductor (SPEC §7.4). */
  vehicleHit(v, shooter, x, y, base) {
    const reach = 0x40 + 0x80;
    if (v.hidden || v.driver === shooter) return false;
    if (Math.abs(v.x - x) > reach || Math.abs(v.y - y) > reach) return false;
    if (base > v.z + 0x100 || v.z > base + 0x100) return false;
    v.events |= Ev.BULLET;
    v.attacker = shooter;
    v.health -= 1;
    return true;
  }

  shielded(p) {
    return p.equipped?.weapon === W.ENERGY_SHIELD && p.equipped.ammo >= 0;
  }

  /** Probabilidad de que el impacto cuente según la resistencia: siempre, 1/2, 1/4, 1/6. */
  admits(world, p) {
    switch (resistance(p)) {
      case 0: return true;
      case 1: return world.rng.int(2) === 0;
      case 2: return world.rng.int(4) === 0;
      default: return world.rng.int(6) === 0;
    }
  }

  /** Aplica el daño del manejador del estado de reacción. Devuelve true si la persona muere. */
  applyReaction(p, state) {
    const rule = EVENT_DAMAGE[state]?.[resistance(p)];
    if (rule === 'kill') p.health = -1;
    else if (typeof rule === 'number') p.health -= rule;
    return p.health < 0;
  }

  /** Registro de la baja al terminar la animación de muerte (SPEC §6.5, `0x315e0`). */
  registerKill(world, victim) {
    const killer = victim.eventSource;
    if (!killer) return;
    if (killer.isPlayerSquad) {
      const st = world.stats;
      if (victim.is(PersonKind.CIVILIAN)) st.civilians++;
      else if (victim.is(PersonKind.AGENT)) { if (victim.isPlayerSquad) st.agentsLost++; else st.enemyAgents++; }
      else if (victim.is(PersonKind.CRIMINAL)) st.criminals++;
      else if (victim.is(PersonKind.POLICE)) st.police++;
      else if (victim.is(PersonKind.GUARD)) st.guards++;
    }
    if (killer.is(PersonKind.CIVILIAN | PersonKind.AGENT | PersonKind.CRIMINAL)) {
      if (victim.is(PersonKind.POLICE) && !killer.is(PersonKind.POLICE)) killer.wanted = true;
      else killer.aggressive = true;
    }
    world.events.emit('kill', { victim, killer });
  }

  /** Suelta los objetos que lleva al morir. */
  dropItems(world, p) {
    for (const it of p.items) {
      it.owner = null;
      it.x = p.x; it.y = p.y; it.z = p.z; it.hidden = false;
      world.grid.insert(it);
    }
    p.items = [];
    p.equipped = null;
  }
}
