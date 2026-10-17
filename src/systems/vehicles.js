// Vehículos (SPEC §7.4): conducir, subir y bajar. El vehículo se mueve con la velocidad
// de su conductor; la ruta por carretera se decide casilla a casilla mirando las clases
// de carretera de COL01 (6–9, una por sentido).

import { DIR_X, DIR_Y, directionTo } from '../core/angles.js';
import { Vehicle, VehicleCondition } from '../entities/entity.js';
import { Person, PersonKind, Ev, S } from '../entities/person.js';

const LOOKAHEAD_TILES = 6, OBSTACLE_TILES = 3;
const ACCEL = 4, TURN_BRAKE = 8, FOLLOW_GAP = 8, PEDESTRIAN_BRAKE = 0x10;
const NEAR_BRAKE = 12, MIN_NEAR_SPEED = 12;
const LANE_STEP = 0x20;
const BOARD_DISTANCE = 0x80, BOARD_DZ = 0x80;
const X_MIN = 0x200, X_MAX = 0x7e00, Y_MIN = 0x200, Y_MAX = 0x5e00;

/** Clase de carretera que admite cada sentido en la casilla siguiente (`0x36c20`). */
const ROAD_CLASS = new Map([[0x00, 8], [0x40, 7], [0x80, 9], [0xc0, 6]]);
/** Desplazamiento del carril dentro de la casilla para cada sentido (`0x37110`). */
const LANE = new Map([[0x00, ['x', 0xc0]], [0x40, ['y', 0x40]], [0x80, ['x', 0x40]], [0xc0, ['y', 0xc0]]]);

const tile = (v) => v >> 8;

export class Driving {
  /** @param {import('../world/world.js').World} world */
  constructor(world) { this.world = world; }

  // ---------- carretera ----------

  /** ¿Se puede seguir en el sentido `h` desde (x, y, z)? La casilla siguiente, en z − 1, debe ser carretera de ese sentido. */
  roadAhead(x, y, z, h) {
    const want = ROAD_CLASS.get(h & 255);
    if (want === undefined) return false;
    return this.world.map.classAt(x + DIR_X[h & 255], y + DIR_Y[h & 255], z - 1) === want;
  }

  /** Orientación al entrar en una casilla (`0x36ec0`): hacia el eje del destino, recto o un giro de 90°. */
  chooseHeading(x, y, z, h, dest) {
    const alongY = h === 0x00 || h === 0x80, alongX = h === 0x40 || h === 0xc0;
    if (!alongY && !alongX) return h;
    if (alongY && tile(x) !== tile(dest.x)) {
      const t = directionTo(tile(dest.x) - tile(x), 0);
      if (this.roadAhead(x, y, z, t)) return t;
    }
    if (alongX && tile(y) !== tile(dest.y)) {
      const t = directionTo(0, tile(dest.y) - tile(y));
      if (this.roadAhead(x, y, z, t)) return t;
    }
    if (this.roadAhead(x, y, z, h)) return h;
    if (this.roadAhead(x, y, z, (h - 0x40) & 255)) return (h - 0x40) & 255;
    if (this.roadAhead(x, y, z, (h + 0x40) & 255)) return (h + 0x40) & 255;
    return h;
  }

  /** Primera persona o vehículo visible en la casilla de (x, y) a la misma altura (`0x36940`). */
  occupantOfTile(x, y, z, self) {
    for (const e of this.world.grid.query(x, y, x, y)) {
      if (e === self || e.hidden || (e.z & 0xff00) !== (z & 0xff00)) continue;
      if (e.class === 1 || e.class === 2) return e;
    }
    return null;
  }

  /**
   * Mirada adelante (`0x36a50`): simula el recorrido y ajusta la velocidad del conductor
   * por los giros próximos y por lo que haya en las primeras casillas.
   */
  lookahead(driver, v) {
    const dest = driver.destination, max = v.maxSpeed;
    let h = v.heading, x = v.x, y = v.y, turnAt = -1;
    for (let s = 0; s < LOOKAHEAD_TILES; s++) {
      h = this.chooseHeading(x, y, v.z, h, dest);
      if (h !== v.heading && turnAt === -1) turnAt = s;
      x += DIR_X[h]; y += DIR_Y[h];
      if (s >= OBSTACLE_TILES) continue;
      const e = this.occupantOfTile(x, y, v.z, v);
      if (!e) continue;
      if (e instanceof Vehicle) {
        const other = e.driver?.driveSpeed ?? 0;
        driver.driveSpeed = s < 1 ? 0 : other > FOLLOW_GAP ? other - FOLLOW_GAP : 0;
        return;
      }
      if (!driver.isAgent) {
        driver.driveSpeed = s < 1 ? 0 : Math.max(0, driver.driveSpeed - PEDESTRIAN_BRAKE);
        return;
      }
    }
    if (turnAt >= 0) driver.driveSpeed = Math.max(Math.max(0, driver.driveSpeed - TURN_BRAKE), max >> 1);
    else driver.driveSpeed = Math.min(max, driver.driveSpeed + ACCEL);
  }

  /** Acerca una coordenada al carril (desplazamiento `offset` dentro de la casilla), como mucho 0x20. */
  static center(c, offset) {
    const d = (c & 0xff) - offset;
    if (d < -LANE_STEP) return c + LANE_STEP;
    if (d > LANE_STEP) return c - LANE_STEP;
    return c - d;
  }

  // ---------- conducir ----------

  /** Un ciclo de conducción hacia `driver.destination` (`0x37110`). Termina la acción al llegar. */
  drive(driver, v) {
    const dest = driver.destination;
    if (!dest) { driver.finishAction(); return; }
    if (v.straight) this.#driveStraight(driver, v, dest);
    else this.#driveRoad(driver, v, dest);
  }

  #driveStraight(driver, v, dest) {
    const dtx = Math.abs(tile(dest.x) - tile(v.x)), dty = Math.abs(tile(dest.y) - tile(v.y));
    let far;
    if (dty < dtx) { v.heading = directionTo(dest.x - v.x, 0); v.y = Driving.center(v.y, 0x80); far = dtx; }
    else { v.heading = directionTo(0, dest.y - v.y); v.x = Driving.center(v.x, 0x80); far = dty; }
    const max = v.maxSpeed;
    if (far === 0) driver.driveSpeed = 0;
    else if (far < 3) driver.driveSpeed = Math.max(MIN_NEAR_SPEED, driver.driveSpeed - NEAR_BRAKE);
    else if (far === 3) driver.driveSpeed = max >> 1;
    else driver.driveSpeed = Math.min(max, driver.driveSpeed + ACCEL);
    if (tile(v.x) === tile(dest.x) && tile(v.y) === tile(dest.y)) driver.finishAction();
    this.#advance(v, driver.driveSpeed);
  }

  #driveRoad(driver, v, dest) {
    this.lookahead(driver, v);
    const lane = LANE.get(v.heading);
    if (lane) v[lane[0]] = Driving.center(v[lane[0]], lane[1]);
    const here = `${tile(v.x)},${tile(v.y)}`;
    if (driver.driveTile !== here) {
      v.heading = this.chooseHeading(v.x, v.y, v.z, v.heading, dest);
      driver.driveTile = here;
    }
    if (tile(v.x) === tile(dest.x) && tile(v.y) === tile(dest.y) && this.world.map.classAt(v.x, v.y, v.z - 1) !== 0) driver.finishAction();
    if (driver.driveSpeed) this.#advance(v, driver.driveSpeed);
  }

  #advance(v, speed) {
    v.x = Math.min(X_MAX, Math.max(X_MIN, v.x + ((DIR_X[v.heading] * speed) >> 8)));
    v.y = Math.min(Y_MAX, Math.max(Y_MIN, v.y + ((DIR_Y[v.heading] * speed) >> 8)));
    this.world.grid.move(v);
    this.carry(v);
  }

  /** Los ocupantes viajan con el vehículo. */
  carry(v) {
    for (const p of v.occupants) { p.x = v.x; p.y = v.y; p.z = v.z; }
  }

  // ---------- subir y bajar ----------

  /** ¿Está la persona lo bastante cerca para subir? (`0x32300`) */
  static canBoard(p, v) {
    return Math.hypot(v.x - p.x, v.y - p.y) < BOARD_DISTANCE && Math.abs(v.z - p.z) <= BOARD_DZ;
  }

  /** Sube: el primero en entrar conduce. Devuelve 'driver' o 'passenger'. */
  board(p, v) {
    v.occupants.push(p);
    p.vehicle = v;
    p.hidden = true;
    p.x = v.x; p.y = v.y; p.z = v.z;
    this.world.grid.remove(p);
    if (v.occupants.length === 1) { p.driveSpeed = 0; p.driveTile = null; return 'driver'; }
    return 'passenger';
  }

  /** Baja (`0x32480`): sale de la cadena, deja de estar oculta y aparece en (x+1, y+1). */
  leave(p) {
    const v = p.vehicle;
    if (!v) return;
    v.occupants.splice(v.occupants.indexOf(p), 1);
    p.vehicle = null;
    p.hidden = false;
    p.driveSpeed = 0;
    p.x = v.x + 1; p.y = v.y + 1; p.z = v.z;
    this.world.grid.insert(p);
  }
}

// ---------- daño, explosión y trenes (SPEC §7.4, `0x39890`) ----------

const RUN_OVER_SPEED = 0x1f;                 // el conductor debe ir a más de esto para atropellar
const RUN_OVER_BOX = [0xf0, 0xf0, 0x100];
const DAMAGE_FIRE = 10, DAMAGE_HEAVY = 300;  // fuego; láser o explosión
const BURN_CYCLES = 100;                     // la resistencia pasa a contar los ciclos de fuego
const KEEP_EVENTS = 0x200;
const EXPLOSION_SOUND = 9, EXPLOSION_ANIM = 0x186, FLAME_ANIM = 0x187;
const BLAST_BOX = [0x100, 0x100, 0x200], BLAST_DROP = 0x100, BLAST_SPREAD = 0x80;
const FLAME_BOX = [0x40, 0x40, 0x40], FLAME_SCATTER = 0x80, FLAME_LIFT = 0x80, FLAME_RISE = 0x30;
const MAX_BARS = 255;

/**
 * Marca con `bits` a las personas y vehículos que solapan una caja (`0x12880`): base en z,
 * altura `h`, y anchura y fondo `w`, `d` centrados en (x, y). Las personas añaden ±0x20 a la
 * caja y los vehículos ±0x80; altura 0x100 en ambos. Si hay `source`, queda como autor.
 */
export function areaEvent(world, x, y, z, [w, d, h], bits, source = null, exclude = null) {
  const hw = w >> 1, hd = d >> 1, reach = 0x80;
  for (const e of world.grid.query(x - hw - reach, y - hd - reach, x + hw + reach, y + hd + reach)) {
    if (e === exclude || e.hidden) continue;
    const ext = e instanceof Person ? 0x20 : e instanceof Vehicle ? 0x80 : -1;
    if (ext < 0 || (e instanceof Person && (e.corpse || world.invulnerable?.(e)))) continue;
    if (Math.abs(e.x - x) > hw + ext || Math.abs(e.y - y) > hd + ext) continue;
    if (z > e.z + 0x100 || e.z > z + h) continue;
    e.events |= bits;
    if (source) { if (e instanceof Person) e.eventSource = source; else e.attacker = source; }
  }
}

/** Ciclo de cada vehículo: enganche, condición (intacto → ardiendo → chatarra) y animación. */
export class VehicleUpdate {
  /** @param {import('../world/world.js').World} world */
  constructor(world) { this.world = world; }

  update(v) {
    const w = this.world;
    if (v.link) this.follow(v);
    switch (v.model ? v.condition : -1) {
      case VehicleCondition.INTACT: this.intact(v); break;
      case VehicleCondition.BURNING: this.burning(v); break;
      case VehicleCondition.WRECK: if (!v.model.stillWreck) w.animator.advance(v); break;
    }
    if (v.animation >= 0) w.animator.setAnimation(v, v.animation);
    w.driving.carry(v);
  }

  /** Vagones y locomotora de cola: misma posición que la entidad a la que van enganchados más su desplazamiento. */
  follow(v) {
    const { link, linkOffset: o } = v;
    v.x = link.x + o.x; v.y = link.y + o.y; v.z = link.z + o.z;
    this.world.grid.move(v);
  }

  /** `0x39660`: explota si la resistencia es negativa; si no, atropella, endereza el rumbo y atiende los impactos. */
  intact(v) {
    if (v.health < 0) { this.explode(v); return; }
    const d = v.driver;
    if (d && (d.isAgent || v.straight || v.wagon) && d.driveSpeed > RUN_OVER_SPEED) {
      areaEvent(this.world, v.x, v.y, v.z, RUN_OVER_BOX, Ev.OTHER, null, v);
    }
    v.heading = (v.heading + 0x20) & 0xc0;
    this.world.animator.advance(v);
    this.resolveEvents(v);
  }

  /** `0x395d0`: el daño cuenta si no lo ha causado el propio conductor. */
  resolveEvents(v) {
    const ev = v.events;
    v.events &= KEEP_EVENTS;
    if (!ev || v.attacker === v.driver) return;
    if (ev & Ev.FIRE) v.health -= DAMAGE_FIRE;
    else if (ev & (Ev.LASER | Ev.EXPLOSION)) v.health -= DAMAGE_HEAVY;
    else if (!(ev & Ev.BULLET)) return;      // la bala ya restó 1 al impactar
    this.bailOut(v);
  }

  /**
   * `0x39530`: al recibir daño, los civiles bajan y huyen y los policías y guardias bajan
   * y persiguen al atacante. Los agentes, los criminales y quien sigue a alguien se quedan.
   * Las locomotoras no sueltan a nadie.
   */
  bailOut(v) {
    if (v.straight) return;
    for (const p of [...v.occupants]) {
      if (p.following) continue;
      let next;
      if (p.is(PersonKind.CIVILIAN)) next = S.FLEE;
      else if (p.is(PersonKind.POLICE | PersonKind.GUARD)) next = S.PURSUE;
      else continue;
      this.world.driving.leave(p);
      p.state = p.nextState = next;
      p.target = v.attacker;
      for (const bar of [p.adrenaline, p.perception, p.intelligence]) bar.level = MAX_BARS;
    }
  }

  /** Destrucción: la resistencia pasa a contar los ciclos que arde y se genera una explosión en (x+1, y+1). */
  explode(v) {
    v.health = BURN_CYCLES;
    v.subtype = v.model.burning;
    this.blast(v.x + 1, v.y + 1, v.z, v.attacker);
  }

  /**
   * Explosión (efecto 0xD de `0x1eb80`): sonido 9, evento de explosión en 2×2 cajas
   * alrededor del punto y llamas en un punto al azar a ±0x80.
   */
  blast(x, y, z, source) {
    const w = this.world;
    w.events.emit('sound', { id: EXPLOSION_SOUND, at: { x, y, z } });
    for (const bx of [x - BLAST_SPREAD, x + BLAST_SPREAD]) {
      for (const by of [y - BLAST_SPREAD, y + BLAST_SPREAD]) areaEvent(w, bx, by, z - BLAST_DROP, BLAST_BOX, Ev.EXPLOSION, source);
    }
    w.spawnEffect(x, y, z, EXPLOSION_ANIM);
    const fx = x + w.rng.int(0x100) - FLAME_SCATTER, fy = y + w.rng.int(0x100) - FLAME_SCATTER;
    this.flame(fx, fy, z + FLAME_LIFT, source);
  }

  /** Llama (efectos 0x29/0x2A): sube 0x30 por ciclo quemando lo que toca; avanza un frame cada 2 ciclos. */
  flame(x, y, z, source) {
    const fx = this.world.spawnEffect(x, y, z, FLAME_ANIM);
    let cycle = 0;
    fx.tick = (w) => {
      areaEvent(w, fx.x, fx.y, fx.z, FLAME_BOX, Ev.FIRE, source);
      fx.z += FLAME_RISE;
      return ++cycle % 2 === 0 && w.animator.advance(fx);
    };
    return fx;
  }

  /** `0x39730`/`0x394e0`: arde un ciclo menos; los ocupantes salen ardiendo. Al acabar, chatarra. */
  burning(v) {
    const w = this.world;
    if (--v.health < 0) {
      v.subtype = v.model.wreck;
      if (v.attacker?.isPlayerSquad) w.stats.propertyDamage += v.model.value;
    }
    w.animator.advance(v);
    for (const p of [...v.occupants]) {
      w.driving.leave(p);
      p.eventSource = v.attacker;
      p.state = S.HIT_FIRE;
      p.reactionApplied = false;
    }
  }
}
