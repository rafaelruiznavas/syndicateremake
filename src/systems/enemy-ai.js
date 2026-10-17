// Agentes enemigos con guion (SPEC §7.3; `0x15560`, `0x15660`, `0x15b10`, `0x15c60`).
// Cada grupo con guion tiene hasta 8 miembros; cada miembro ejecuta pasos de guion y,
// cuando tiene un blanco, se acerca y dispara con las mismas órdenes que el jugador.

import { PersonKind, S } from '../entities/person.js';
import { lineOfFire } from './perception.js';

const MODS_BY_LEVEL = [0, 0x0aaa, 0x1554, 0x1ffe];
const RESEARCHED = 0x960;
const PLAYER_NEAR = 0xf00;
const STUN_TICKS = 10;

/** Estado del miembro (SPEC §7.3). */
const M = Object.freeze({ PICK: 0, START: 1, RUN: 2, HUNT: 9, DONE: 0x0d, STUNNED: 0x0c });

export class EnemyAI {
  /**
   * @param {object} config enemyAI del nivel
   * @param {{research: Map<number, number>, enemyWeapons: {priority,weapon}[]}} context
   */
  constructor(world, config, context) {
    this.world = world;
    this.config = config;
    this.steps = config.steps.map((s) => ({ ...s, done: false, uses: 0 }));
    this.cycle = 0;
    this.members = [];
    for (let g = 1; g < config.groups; g++) this.#setupGroup(g, context);
  }

  /** Equipo y estado inicial de los agentes del grupo g (`0x15660`). */
  #setupGroup(g, { research, enemyWeapons }) {
    const w = this.world, cfg = this.config;
    const agents = w.people.filter((p) => p.group === g && p.isAgent).slice(0, cfg.agentsPerGroup);
    let weapon = cfg.forcedWeapon;
    if (!weapon) {
      let best = 0;
      for (const { priority, weapon: t } of enemyWeapons) if (priority > best && research.get(t) === RESEARCHED) { best = priority; weapon = t; }
    }
    for (const p of agents) {
      p.kind |= PersonKind.SCRIPTED | PersonKind.DEPLOYED;
      p.objectiveMarked = true;
      p.health = 16;
      p.mods = MODS_BY_LEVEL[cfg.modsLevel] ?? 0;
      if (weapon) w.giveItem(p, weapon, w.weapons.fullAmmo(weapon), true);
      if (cfg.timeBomb) w.giveItem(p, 12, 199, false);
      if (cfg.persuadertron) w.giveItem(p, 1, 50, false);
      this.members.push({ person: p, group: g, state: M.PICK, step: null, target: null, counter: 0, aux: cfg.firstStep, stunned: 0, resume: M.PICK });
    }
  }

  /** Un ciclo (`0x15b10`): el guion avanza cada `cyclesPerTick` ciclos. */
  update() {
    this.cycle++;
    const tick = this.config.cyclesPerTick === 0 || this.cycle % this.config.cyclesPerTick === 0;
    for (const m of this.members) {
      const p = m.person;
      if (p.dead) { m.state = M.DONE; continue; }
      if (m.state === M.DONE) continue;
      if (p.events & 0x40 && m.state !== M.STUNNED) { m.resume = m.state; m.state = M.STUNNED; m.counter = STUN_TICKS; }
      if (!tick && m.state !== M.STUNNED) continue;
      this.#run(m);
    }
  }

  #run(m) {
    const p = m.person;
    switch (m.state) {
      case M.PICK: {
        const step = this.steps.find((s, i) => i > 0 && s.type && !s.done && s.uses === 0) ?? this.steps.find((s, i) => i > 0 && s.type && !s.done);
        if (!step) { m.state = M.DONE; return; }
        step.uses++;
        m.step = step;
        m.state = M.START;
        this.#start(m);
        return;
      }
      case M.START: this.#start(m); return;
      case M.RUN: if (this.#done(m)) this.#advance(m); return;
      case M.HUNT: this.#hunt(m); return;
      case M.STUNNED:
        if (p.state !== S.HIT_RECOVER && p.state !== S.HIT_BULLET && --m.counter <= 0) m.state = m.resume;
        return;
      default: return;
    }
  }

  /** Ejecuta la acción del paso (`0x16550`). */
  #start(m) {
    const w = this.world, p = m.person, s = m.step;
    if (p.items[0]) p.items[0].ammo = Math.max(p.items[0].ammo, w.weapons.fullAmmo(p.items[0].weapon) >> 2);
    switch (s.type) {
      case 1:
        if (s.order === 3) p.walkTo(s.a, s.b, s.c);
        m.state = M.RUN;
        break;
      case 3: m.target = this.#victimInGroup(s.a & 0xff); m.state = m.target ? M.HUNT : M.RUN; break;
      case 4: {
        const obj = w.objectives.list[m.aux] ?? w.objectives.list[0];
        if (obj?.type === 2 || obj?.type === 1) { m.target = obj.entity; m.state = M.HUNT; }
        else if (obj?.type === 0x10) { p.walkTo(obj.x, obj.y, p.z); m.state = M.RUN; }
        else m.state = M.RUN;
        break;
      }
      case 7: m.counter = s.a & 0xff; m.state = M.RUN; break;
      case 8: case 9: m.state = m.target ? M.HUNT : M.RUN; break;
      default: m.state = M.RUN; break;   // [DES] tipos 2, 5, 6 y 10
    }
  }

  /** ¿Se ha cumplido el paso? (`0x16ab0`) */
  #done(m) {
    const p = m.person, s = m.step;
    switch (s.type) {
      case 1: return s.order !== 3 || p.state === S.IDLE || p.state === S.SCRIPT_WAIT;
      case 3: return !m.target;
      case 7: {
        if (m.counter > 0 && m.counter < 0x65) m.counter--;
        const near = this.world.squad.some((a) => !a.dead && Math.hypot(a.x - p.x, a.y - p.y) < PLAYER_NEAR);
        return near || m.counter === 0;
      }
      default: return true;
    }
  }

  #advance(m) {
    const s = m.step;
    s.done = true;
    const next = s.next ? this.steps[s.next] : null;
    if (next && next.type) { m.step = next; m.state = M.START; this.#start(m); }
    else { m.step = null; m.state = M.PICK; }
  }

  /** Víctima del grupo g: primera persona viva del grupo. [DES] `0x34590` puede elegir de otra forma. */
  #victimInGroup(g) {
    const pool = g === 0 ? this.world.squad : this.world.people.filter((q) => q.group === g);
    return pool.find((q) => !q.dead) ?? null;
  }

  /** Caza (estados 6/9/10): con línea de tiro al 90 % del alcance dispara; si no, se acerca. */
  #hunt(m) {
    const w = this.world, p = m.person;
    if (!m.target || m.target.dead) {
      m.target = m.step?.type === 3 ? this.#victimInGroup(m.step.a & 0xff) : null;
      if (!m.target) { this.#advance(m); return; }
    }
    const t = m.target;
    const it = p.items.find((x) => x.ammo >= 0 && w.weapons.range(x.weapon) > 256) ?? null;
    if (!it) { p.walkTo(t.x, t.y, t.z); return; }
    const range = Math.trunc((w.weapons.range(it.weapon) * 9) / 10);
    // [DIS] También dispara si la línea de tiro cruza a otro miembro del grupo del blanco.
    const first = lineOfFire(w, p, t, range);
    if (first === t || (first && !first.dead && first.group === t.group && first.group !== p.group)) {
      p.equipped = it;
      w.weapons.activate(p, t.x, t.y, t.z + 0x80);
    } else if (p.state !== S.WALK) {
      p.walkTo(t.x, t.y, t.z);
    }
  }
}
