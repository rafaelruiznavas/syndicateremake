// Máquina de estados de las personas (SPEC §7.1; despachador `0x34110`).
// Cada manejador corresponde a un estado documentado; los marcados [INF]/[DIS] en la
// SPEC siguen una interpretación provisional.

import { S } from '../entities/person.js';
import { Vehicle } from '../entities/entity.js';
import { walkStep, tryStep, effectiveSpeed } from './movement.js';
import { Detours, WALL_DELTA, DETOUR_TIMER } from './detour.js';
import { Driving } from './vehicles.js';
import { runScenarioStep } from './scenario.js';
import { lineOfFire } from './perception.js';
import { directionTo } from '../core/angles.js';

const FOLLOW_DISTANCE = 0x180;          // [DIS] distancia a la que se queda un seguidor
const FLEE_DISTANCE = 0x800;            // [DIS] distancia de huida
const ATTACK_MIN = 80, APPROACH_MIN = 300;   // estado 0x20 (GH: `0x337b0`)
const VEHICLE_REACH = 0x80;             // `0x321c0`: a un vehículo se llega a < 0x80
const GROUND_NO_EXIT = 2;               // `0x32560`, orden 0x19: no se baja sobre esta clase
const WATCH_COLS = 5, WATCH_ROWS = 7;   // estado 0x28 (`0x33dc0`)

export class PersonStates {
  constructor(world) { this.world = world; }

  update(p) {
    const w = this.world;
    if (p.corpse) return;
    this.terrainReaction(p);
    if (p.isAgent) this.regenerate(p);
    const handler = this.handlers[p.state] ?? this.idle;
    handler.call(this, p);
    if (p.fireWindow > 0) p.fireWindow--;
    if (!p.animLocked) w.animator.refreshPerson(p);
    p.animLocked = false;
  }

  // ---------- comunes ----------
  advance(p) { return this.world.animator.advance(p); }
  /** Resuelve eventos pendientes y aplica el estado resultante. */
  events(p) {
    const next = p.resolveEvents(this.world);
    if (next !== p.state) { p.state = next; p.reactionApplied = false; }
  }

  /** Clase 10 bajo los pies: muerte (SPEC §7.1 punto 1). [DIS] Las rampas que hacen deslizar se omiten. */
  terrainReaction(p) {
    if (p.state === S.TERRAIN_DEATH || p.dead || this.world.invulnerable?.(p)) return;
    if (this.world.map.classAt(p.x, p.y, p.z - 1) === 10) { p.health = -1; p.state = S.TERRAIN_DEATH; }
  }

  /** Regeneración de salud de los agentes según el pecho (SPEC §6.3, `0x2fae0`). */
  regenerate(p) {
    p.regenCounter = (p.regenCounter + 1) & 0xff;
    if (p.adrenaline.level < 10) p.regenCounter &= 7;
    if (p.health < 0 || p.health >= 16) return;
    const lvl = (p.mods & 0x60) >> 5;
    const mask = [0, 0x7f, 0x3f, 0x1f][lvl];
    if (lvl && (p.regenCounter & mask) === 0) p.health++;
  }

  // ---------- manejadores ----------
  idle(p) { this.advance(p); this.events(p); }

  scenario(p) { runScenarioStep(this.world, p, this.world.scenarioSteps); }

  /** Andar a un punto (`0x32130`); dentro de un vehículo, conducirlo. Si se bloquea, desvío. */
  walk(p) {
    if (p.vehicle) { this.driveTowards(p); return; }
    if (!p.destination) { p.finishAction(); return; }
    const w = this.world;
    const result = walkStep(p, w.terrain, w.carriedWeight(p));
    w.grid.move(p);
    if (result === 'arrived') { p.destination = null; p.finishAction(); }
    else if (result === 'blocked') w.detours.start(p, DETOUR_TIMER);
    this.events(p);
    this.advance(p);
  }

  /** Solo el conductor mueve el vehículo [DIS]; un pasajero da la orden por cumplida. */
  driveTowards(p) {
    const v = p.vehicle;
    if (v.driver === p && !v.wagon) this.world.driving.drive(p, v);
    else { p.destination = null; p.finishAction(); }
    this.events(p);
  }

  /** Ir hacia una entidad (`0x321c0`): a un vehículo se llega a < 0x80; si ya va en uno, conduce. */
  gotoTarget(p) {
    const t = p.target;
    if (!t || t.dead || (t.owner && t.owner !== p)) { p.finishAction(); return; }
    if (t instanceof Vehicle && Math.hypot(t.x - p.x, t.y - p.y) < VEHICLE_REACH) { p.finishAction(); return; }
    p.destination = { x: t.x, y: t.y, z: t.z };
    if (p.vehicle) { this.driveTowards(p); return; }
    const w = this.world;
    const result = walkStep(p, w.terrain, w.carriedWeight(p));
    w.grid.move(p);
    if (result === 'arrived') p.finishAction();
    else if (result === 'blocked') w.detours.start(p, DETOUR_TIMER);
    this.events(p);
    this.advance(p);
  }

  /** Subir (`0x32300`): el primero conduce y termina; los demás (y en los vagones) pasan al estado 8. */
  board(p) {
    const v = p.target;
    if (!(v instanceof Vehicle) || p.vehicle) { p.finishAction(); return; }
    if (!Driving.canBoard(p, v)) { p.state = S.GOTO_VEHICLE; p.nextState = S.BOARD; return; }
    const role = this.world.driving.board(p, v);
    if (role === 'driver' && !v.wagon) p.finishAction();
    else p.state = S.IN_VEHICLE;
  }

  /** Dentro (`0x32560`): baja si el líder al que sigue ya no va en vehículo. */
  inVehicle(p) {
    if (p.following && !p.following.vehicle && this.world.map.classAt(p.x, p.y, p.z - 1) !== GROUND_NO_EXIT) {
      p.state = S.LEAVE_VEHICLE; p.nextState = S.FOLLOW;
      return;
    }
    p.nextState = p.state;
    p.finishAction();
  }

  /** Bajar (`0x32480`). */
  leaveVehicle(p) {
    if (p.vehicle) this.world.driving.leave(p);
    else p.nextState = p.state;
    p.finishAction();
  }

  /** Seguir la pared (estados 0xE y 0xF, `0x32930`/`0x32aa0`). */
  wallFollow(p) {
    const w = this.world;
    if (Detours.arrived(p)) { p.finishAction(); return; }
    p.speed = effectiveSpeed(p, w.carriedWeight(p));
    if (!w.detours.follow(p, WALL_DELTA[p.state])) { p.finishAction(); return; }
    tryStep(p, p.facing, p.speed, w.terrain);
    w.grid.move(p);
    this.events(p);
    this.advance(p);
  }

  /** Esperar a un agente (`0x33dc0`): revisa una fila de 5 casillas por ciclo, 7 filas. */
  waitAgent(p) {
    const watch = p.watch;
    if (!watch) { p.finishAction(); return; }
    p.watchRow = p.watchRow >= 0 && p.watchRow < WATCH_ROWS - 1 ? p.watchRow + 1 : 0;
    const y = (watch.ty + p.watchRow) << 8;
    for (const e of this.world.grid.query(watch.tx << 8, y, (watch.tx + WATCH_COLS - 1) << 8, y)) {
      if (e.class === 1 && e.isAgent && e.z === watch.z) { p.finishAction(); return; }
    }
    this.events(p);
    this.advance(p);
  }

  approach(p) {
    const t = p.target;
    if (!t || t.dead) { p.finishAction(); return; }
    if ((p.x >> 8) === (t.x >> 8) && (p.y >> 8) === (t.y >> 8)) { p.state = S.ADJACENT; p.timer = 0x14; }
    else this.stepTowards(p, t.x, t.y);
    this.events(p);
    this.advance(p);
  }

  /** [INF] Junto al objetivo: si tiene arma, dispara; si no, espera y termina. */
  adjacent(p) {
    const t = p.target;
    if (t && !t.dead && p.equipped && p.equipped.ammo >= 0) this.world.weapons.activate(p, t.x, t.y, t.z + 0x80);
    else if (--p.timer <= 0) p.finishAction();
    this.events(p);
  }

  /** Reacción a un impacto: aplica el daño una vez, anima y pasa a recuperarse (0x16). */
  reaction(p) {
    const w = this.world;
    if (!p.reactionApplied) {
      p.reactionApplied = true;
      const died = w.damage.applyReaction(p, p.state, w);
      if (p.state === S.HIT_FIRE) { p.timer = died ? 40 : 2; p.state = S.BURNING; return; }
    }
    if (this.advance(p)) p.state = S.HIT_RECOVER;
  }

  recover(p) {
    if (p.health < 0) { p.state = S.DYING; return; }
    p.finishAction();
    this.events(p);
  }

  /** Arder (SPEC §7.1, `0x32c10`): correr sin rumbo mientras dura el contador. */
  burning(p) {
    const w = this.world;
    p.canDrop = true;
    if (p.timer-- >= 0) {
      p.facing = (p.facing + w.rng.int(15) - 7) & 255;
      p.adrenaline.level = Math.min(255, p.adrenaline.level + 6);
      tryStep(p, p.facing, effectiveSpeed(p), w.terrain);
      w.grid.move(p);
      this.advance(p);
      return;
    }
    p.canDrop = false;
    if (p.health < 0) p.state = S.DYING_BURNT;
    else p.finishAction();
  }

  dying(p) {
    const w = this.world;
    if (!p.dropped) { w.damage.dropItems(w, p); p.dropped = true; }
    if (this.advance(p)) {
      p.state = p.state === S.DYING_BURNT ? S.DEAD_BURNT : S.DEAD;
      if (p.state === S.DEAD_BURNT) p.timer = 100;
      w.damage.registerKill(w, p);
    }
  }

  terrainDeath(p) {
    if (this.advance(p)) { p.state = S.DEAD; this.world.damage.registerKill(this.world, p); }
  }

  /** Apuntar (`0x33120`): primer blanco de otro grupo con línea de tiro → disparar. */
  aim(p) {
    const w = this.world;
    p.fireWindow = 0;
    const gate = p.intelligence.scale(100);
    let it = p.equipped;
    if (it && it.ammo < 0) {
      const alt = w.weapons.choose(p, 0);
      if (!alt || alt === it) { p.finishAction(); return; }
      p.equipped = it = alt;
    }
    if (it && gate > 0) {
      const range = p.perception.scale(w.weapons.range(it.weapon) >> 8) << 8;
      const t = this.firstTarget(p, range);
      if (t) w.weapons.activate(p, t.x, t.y, t.z + 0x80);
    }
    if (p.state === S.AIM) {
      this.advance(p);
      if (p.timer === 0) p.finishAction();
      p.timer--;
      this.events(p);
    }
  }

  /** `0x316d0`: recorre el pool en orden y devuelve la primera persona válida con línea de tiro. */
  firstTarget(p, range) {
    for (const t of this.world.people) {
      if (t === p || t.group === p.group || t.dead || t.hidden || t.following) continue;
      if (!t.equipped && !t.isAgent) continue;
      if (lineOfFire(this.world, p, t, range) === t) return t;
    }
    return null;
  }

  /** Disparando (`0x33fb0`): las semiautomáticas esperan a que acabe la animación. */
  firing(p) {
    const w = this.world;
    const next = p.resolveEvents(w);
    if (next !== p.state) { p.state = next; p.reactionApplied = false; return; }
    const ended = this.advance(p);
    p.animLocked = true;
    if (!ended && !w.weapons.isAutomatic(p.equipped)) return;
    w.animator.refreshPerson(p);
    p.finishAction();
  }

  /** [DIS] Seguir al persuasor manteniéndose cerca. */
  follow(p) {
    const leader = p.following;
    if (!leader || leader.dead) { p.following = null; p.finishAction(); return; }
    if (Math.hypot(leader.x - p.x, leader.y - p.y) > FOLLOW_DISTANCE) this.stepTowards(p, leader.x, leader.y);
    this.events(p);
    this.advance(p);
  }

  /** [DIS] Huir alejándose del blanco. */
  flee(p) {
    const t = p.target;
    if (!t || Math.hypot(t.x - p.x, t.y - p.y) > FLEE_DISTANCE) { p.target = null; p.finishAction(); return; }
    const dir = (directionTo(p.x - t.x, p.y - t.y)) & 255;
    p.facing = dir;
    if (!tryStep(p, dir, effectiveSpeed(p), this.world.terrain)) tryStep(p, (dir + 64) & 255, effectiveSpeed(p), this.world.terrain);
    this.world.grid.move(p);
    this.events(p);
    this.advance(p);
  }

  /** Perseguir y atacar (GH `0x337b0`): dispara a ≥ 80 si está a tiro; se acerca si ≥ 300. */
  pursue(p) {
    const w = this.world, t = p.target;
    if (!t || t.dead) { p.target = null; p.finishAction(); return; }
    const d = Math.hypot(t.x - p.x, t.y - p.y);
    const it = p.equipped;
    const range = it ? p.perception.scale(w.weapons.range(it.weapon)) : 0;
    if (it && it.ammo >= 0 && d >= ATTACK_MIN && d < range && lineOfFire(w, p, t, range) === t) {
      w.weapons.activate(p, t.x, t.y, t.z + 0x80);
      return;
    }
    if (d >= APPROACH_MIN) this.stepTowards(p, t.x, t.y);
    this.events(p);
    this.advance(p);
  }

  /** [INF] Aviso de policía o guardia: espera y, si el blanco sigue armado, ataca. */
  warn(p) {
    const t = p.target;
    if (!t || t.dead) { p.finishAction(); return; }
    p.facing = directionTo(t.x - p.x, t.y - p.y);
    if (p.waitCycles-- > 0) { this.events(p); return; }
    const armed = t.equipped && this.world.perception.armedTable[t.equipped.weapon];
    p.state = armed || p.is(8) ? S.PURSUE : S.IDLE;
  }

  wait(p) { if (--p.timer <= 0) p.finishAction(); this.events(p); this.advance(p); }
  scriptWait(p) { this.advance(p); this.events(p); }
  converted(p) { if (this.advance(p)) p.state = S.FOLLOW; }

  stepTowards(p, x, y) {
    p.destination = { x, y, z: p.z };
    const r = walkStep(p, this.world.terrain, this.world.carriedWeight(p), { neighbours: true });
    p.destination = null;
    this.world.grid.move(p);
    return r;
  }

  get handlers() {
    return this._handlers ??= {
      [S.IDLE]: this.idle, [S.SCENARIO]: this.scenario, [S.WALK]: this.walk, [S.WALK_SCENARIO]: this.walk,
      [S.GOTO_THING]: this.gotoTarget, [S.GOTO_VEHICLE]: this.gotoTarget, [S.BOARD]: this.board,
      [S.LEAVE_VEHICLE]: this.leaveVehicle, [S.IN_VEHICLE]: this.inVehicle,
      [S.WALL_LEFT]: this.wallFollow, [S.WALL_RIGHT]: this.wallFollow, [S.WAIT_AGENT]: this.waitAgent,
      [S.APPROACH]: this.approach, [S.ADJACENT]: this.adjacent,
      [S.HIT_LASER]: this.reaction, [S.HIT_BULLET]: this.reaction, [S.HIT_OTHER]: this.reaction,
      [S.HIT_FIRE]: this.reaction, [S.HIT_EXPLOSION]: this.reaction, [S.HIT_RECOVER]: this.recover,
      [S.BURNING]: this.burning, [S.DYING]: this.dying, [S.DYING_BURNT]: this.dying,
      [S.TERRAIN_DEATH]: this.terrainDeath, [S.AIM]: this.aim, [S.FIRING]: this.firing,
      [S.FOLLOW]: this.follow, [S.FLEE]: this.flee, [S.PURSUE]: this.pursue, [S.WARN]: this.warn,
      [S.WAIT]: this.wait, [S.SCRIPT_WAIT]: this.scriptWait, [S.CONVERTED]: this.converted,
    };
  }
}

