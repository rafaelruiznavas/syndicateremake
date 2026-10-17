// Percepción y reacción de personas (SPEC §7.1 punto 4 y §7.2).

import { Person, PersonKind, S } from '../entities/person.js';
import { directionTo } from '../core/angles.js';

export const Seen = Object.freeze({ ARMED: 1, FIRING: 8, AGENT: 0x10, MARKED: 0x20, ALARM: 0x80 });

const ELIGIBLE = new Set([0, 2, 3, 4, 5, 0x0c, 0x10, 0x1d, 0x28, 0x29]);
const AGENT_EXTRA = new Set([0x0e, 0x0f]);
const PER_CYCLE = 8;
const WARNING_SOUND = 0x1c, WARNING_COOLDOWN = 0x38;

export class Perception {
  constructor(world, armedTable) {
    this.world = world;
    this.armedTable = armedTable;   // weapon-armed.json
    this.visible = [];              // [{person, flags}] del ciclo anterior
    this.cursor = 0;
    this.warningCooldown = 0;
  }

  /** Construye la lista de visibles al final del ciclo (`0x31df0`). */
  collect() {
    const list = [];
    for (const p of this.world.people) {
      if (p.dead || p.hidden || p.following) continue;
      if (!(p.kind & (PersonKind.AGENT | PersonKind.POLICE | PersonKind.GUARD))) continue;
      let flags = 0;
      if (p.equipped && this.armedTable[p.equipped.weapon]) { flags |= Seen.ARMED; if (p.fireWindow) flags |= Seen.FIRING; }
      if (p.objectiveMarked) flags |= Seen.MARKED;
      else if (p.isAgent) flags |= Seen.AGENT;
      if (flags) list.push({ person: p, flags });
    }
    this.visible = list.slice(0, 0x100);
  }

  /** Procesa hasta 8 personas por ciclo en orden circular (`0x31830`). */
  update() {
    const w = this.world, people = w.people;
    if (this.warningCooldown) this.warningCooldown--;
    if (!this.visible.length || !people.length) return;
    let handled = 0;
    for (let guard = 0; guard < people.length && handled < PER_CYCLE; guard++) {
      const p = people[this.cursor++ % people.length];
      if (!this.eligible(p)) continue;
      handled++;
      if (!p.isAgent || p.objectiveMarked) this.reactCivilian(p);
      else this.reactAgent(p);
    }
  }

  eligible(p) {
    if (p.class !== 1 || p.dead || p.hidden || p.vehicle || p.following) return false;
    if (p.kind & 0x30) return false;
    return ELIGIBLE.has(p.state) || (p.isAgent && AGENT_EXTRA.has(p.state));
  }

  distance(a, b) { return Math.floor(Math.hypot(b.x - a.x, b.y - a.y)); }

  reactCivilian(p) {
    for (const { person: t, flags } of this.visible) {
      if (t === p) continue;
      if (flags & Seen.ALARM) { this.flee(p, t); return; }
      const d = this.distance(p, t);
      if (p.is(PersonKind.POLICE)) {
        if (d < 0xa00 && d <= p.perception.scale(0xa00) && (flags & 0x11) === 0x11) { this.challenge(p, t, d, true); return; }
      } else if (p.is(PersonKind.CIVILIAN)) {
        if (d < p.perception.scale(0xa00) && (flags & Seen.ARMED)) { this.flee(p, t); return; }
      } else if (p.is(PersonKind.GUARD)) {
        if (d < 0xa00 && d <= p.perception.scale(0x800) && (flags & Seen.AGENT)) { this.challenge(p, t, d, false); return; }
      }
    }
  }

  /** Policía o guardia: elige arma y pasa a avisar (0x22); sin arma huye. */
  challenge(p, t, d, withSound) {
    const weapon = this.world.weapons.choose(p, d);
    if (!weapon) { this.flee(p, t); return; }
    p.equipped = weapon;
    p.target = t;
    p.timer = p.intelligence.scale(50);
    p.waitCycles = 30 - p.intelligence.scale(30);
    p.state = S.WARN;
    if (withSound && !this.warningCooldown) { this.world.events.emit('sound', { id: WARNING_SOUND, at: p }); this.warningCooldown = WARNING_COOLDOWN; }
  }

  flee(p, t) { p.target = t; p.state = S.FLEE; }

  reactAgent(p) {
    if (p.intelligence.scale(100) <= 0) return;
    for (const { person: t, flags } of this.visible) {
      if (t === p || t.following || t.group === p.group) continue;
      if (!(flags & 0x11)) continue;
      const d = this.distance(p, t);
      if (d >= 0xe00) continue;
      const weapon = this.world.weapons.choose(p, d);
      if (!weapon) { if (!p.items.length) this.flee(p, t); continue; }
      p.equipped = weapon;
      const range = p.perception.scale(this.world.weapons.range(weapon.weapon));
      if (d >= range) continue;
      if (lineOfFire(this.world, p, t, range) === t) {
        p.target = t;
        p.timer = 3;
        p.facing = directionTo(t.x - p.x, t.y - p.y);
        p.state = S.AIM;
        return;
      }
    }
  }
}

/**
 * Línea de tiro de `from` a `to` (`0x30eb0`): muestras cada 128 u desde z+0x80; devuelve
 * el primer obstáculo (persona interpuesta o `to`) o null si el terreno lo impide o está fuera de alcance.
 */
export function lineOfFire(world, from, to, range) {
  const dx = to.x - from.x, dy = to.y - from.y, dz = to.z - from.z;
  const dist = Math.hypot(dx, dy);
  if (dist >= range) return null;
  const steps = Math.max(1, Math.ceil(dist / 128));
  for (let i = 1; i <= steps; i++) {
    const x = Math.round(from.x + (dx * i) / steps), y = Math.round(from.y + (dy * i) / steps), z = Math.round(from.z + 0x80 + (dz * i) / steps);
    if (world.terrain.solidAt(x, y, z)) return null;
    for (const e of world.grid.query(x - 0x20, y - 0x20, x + 0x20, y + 0x20)) {
      if (!(e instanceof Person) || e === from || e.dead || e.hidden) continue;
      if (Math.abs(e.x - x) <= 0x20 && Math.abs(e.y - y) <= 0x20 && z >= e.z && z <= e.z + 0x100) return e;
    }
  }
  return to;
}
