// Objetivos y estado de la misión (SPEC §8.1; `0x105e0`).

import { PersonKind } from '../entities/person.js';

export const MissionStatus = Object.freeze({ RUNNING: 1, COMPLETED: 2, FAILED: 4, WITHDRAWN: 8 });
const EVACUATION_RADIUS = 0x300;
const END_DELAY_TICKS = 0x240;     // 576 ticks ≈ 7,9 s antes de cerrar tras éxito o fracaso

export class Objectives {
  constructor(world, levelObjectives) {
    this.world = world;
    this.status = MissionStatus.RUNNING;
    this.endTimer = 0;
    this.reason = '';
    this.list = levelObjectives.map((o) => ({ ...o, entity: world.entityFor(o.target), done: false }));
    for (const o of this.list) if (o.type === 1 && o.entity) o.entity.persuasionTarget = true;
  }

  get running() { return this.status === MissionStatus.RUNNING; }
  complete(reason = '') { if (this.running) { this.status = MissionStatus.COMPLETED; this.reason = reason; this.endTimer = END_DELAY_TICKS; this.world.events.emit('sound', { id: 0x17 }); } }
  fail(reason = '') { if (this.running) { this.status = MissionStatus.FAILED; this.reason = reason; this.endTimer = END_DELAY_TICKS; this.world.events.emit('sound', { id: 0x18 }); } }
  withdraw() { if (this.running) { this.status = MissionStatus.WITHDRAWN; this.reason = 'abandonada'; } }

  /** ¿La entidad pertenece al jugador? (un agente de la escuadra o alguien que le sigue). */
  ownedByPlayer(e) {
    let p = e?.owner ?? e;
    for (let i = 0; p && i < 3; i++) { if (p.isPlayerSquad) return true; p = p.following; }
    return false;
  }

  update(ticksPerCycle) {
    if (!this.running) { if (this.endTimer > 0) this.endTimer = Math.max(0, this.endTimer - ticksPerCycle); return; }
    const w = this.world;
    if (w.squad.length && w.squad.every((a) => a.dead)) { this.fail('escuadra eliminada'); return; }
    let allDone = true;
    for (const o of this.list) {
      const e = o.entity;
      switch (o.type) {
        case 1:
          if (e?.dead) { this.fail('objetivo a persuadir muerto'); return; }
          o.done = this.ownedByPlayer(e);
          break;
        case 2: o.done = !!e?.dead; break;
        case 3: if (e?.dead) { this.fail('objetivo protegido muerto'); return; } o.done = true; break;
        case 5: o.done = this.ownedByPlayer(e); break;
        case 10: o.done = !w.people.some((p) => p.is(PersonKind.POLICE) && !p.dead); break;
        case 11: o.done = !w.people.some((p) => p.objectiveMarked && !p.dead && !this.ownedByPlayer(p)); break;
        case 14: o.done = !!(e?.dead || e?.destroyed); break;
        case 15: if (e?.destroyed) { this.fail('vehículo destruido'); return; } o.done = this.ownedByPlayer(e); break;
        case 16: {
          const near = (p) => Math.hypot(p.x - o.x, p.y - o.y) <= EVACUATION_RADIUS;
          o.done = w.squad.every((a) => a.dead || near(a)) &&
            this.list.every((q) => !(q.type === 1 || q.type === 5) || !q.entity || near(q.entity.owner ?? q.entity));
          break;
        }
        default: o.done = true; break;
      }
      if (!o.done) allDone = false;
    }
    if (allDone) this.complete('objetivos cumplidos');
  }
}
