// Persona (clase 1): agentes, civiles, policías, guardias y criminales (SPEC §5.1, §7.1).
// El comportamiento es una máquina de estados explícita cuyos números de estado son los
// del original; así la elección de animación (SPEC §5.4) y las transiciones documentadas
// se aplican sin traducción.

import { Entity } from './entity.js';

export const PersonKind = Object.freeze({ CIVILIAN: 1, AGENT: 2, POLICE: 4, GUARD: 8, CRIMINAL: 0x10, DEPLOYED: 0x400, SCRIPTED: 0x1000 });

/** Estados (SPEC §7.1). */
export const S = Object.freeze({
  IDLE: 0x00, SCENARIO: 0x01, WALK: 0x02, WALK_SCENARIO: 0x03, GOTO_THING: 0x04, GOTO_VEHICLE: 0x05, BOARD: 0x06,
  LEAVE_VEHICLE: 0x07, IN_VEHICLE: 0x08, PICKUP: 0x09,
  APPROACH: 0x0c, ADJACENT: 0x0d, WALL_LEFT: 0x0e, WALL_RIGHT: 0x0f,
  HIT_LASER: 0x11, HIT_BULLET: 0x12, HIT_OTHER: 0x13, HIT_FIRE: 0x14, HIT_EXPLOSION: 0x15, HIT_RECOVER: 0x16,
  BURNING: 0x17, DYING: 0x18, DYING_BURNT: 0x19, DEAD: 0x1a, DEAD_BURNT: 0x1b,
  AIM: 0x1c, WANDER: 0x1d, FOLLOW: 0x1e, FLEE: 0x1f, PURSUE: 0x20, TERRAIN_DEATH: 0x21, WARN: 0x22,
  SLIDE: 0x27, WAIT_AGENT: 0x28, PLATFORM: 0x29, WAIT: 0x2a, FIRING: 0x2b, CONVERTED: 0x2c,
});

/** Eventos de daño acumulados por OR (SPEC §6.2). */
export const Ev = Object.freeze({ OTHER: 0x01, FIRE: 0x08, LASER: 0x10, BULLET: 0x40, EXPLOSION: 0x80, PERSUADE: 0x400 });

const WALKING = new Set([2, 3, 4, 5, 0x0e, 0x0f, 0x1d, 0x1e, 0x1f, 0x20, 0x25, 0x27]);
const DEAD = new Set([S.DEAD, S.DEAD_BURNT]);
const ORDERABLE = new Set([0, 2, 3, 4, 5, 0x0e, 0x0f, 0x1c, 0x1f, 0x26, 0x2c]);

/**
 * Ritmo de la recuperación (`0x2f990`) según el implante (0..3): cada cuántos ciclos el valor
 * real se mueve 1 y cada cuántos se mueve 1 el punto neutro.
 */
const RECOVERY = [{ actual: 4, neutral: 0x14 }, { actual: 8, neutral: 0x1c }, { actual: 0x10, neutral: 0x28 }, { actual: 0x28, neutral: 0x80 }];

/**
 * Barra de comportamiento (SPEC §4, §7.2, §9.2): cuatro bytes del original. El efecto usa el
 * nivel pedido frente al punto neutro; el valor real sigue al nivel poco a poco y, cuando lo
 * alcanza, ambos vuelven hacia el neutro, que a su vez se desplaza hacia lo pedido
 * (dependencia). Un valor forzado distinto de 0 fija nivel = forzado + 0x80 y neutro = forzado.
 */
export class Bar {
  constructor(neutral = 128, level = 128, actual = 128, override = 0) {
    this.neutral = neutral;      // +0x48
    this.level = level;          // +0x49: lo que pide el jugador
    this.actual = actual;        // +0x47
    this.override = override;    // +0x4a
  }

  /** Un ciclo de recuperación (`0x2f990`) con el contador del agente y el nivel de su implante. */
  recover(counter, implant) {
    if (this.override) { this.level = (this.override + 0x80) & 0xff; this.neutral = this.override; return; }
    const rate = RECOVERY[implant] ?? RECOVERY[0];
    if (counter % rate.neutral === 0) {
      const toward = this.neutral === this.level && this.neutral === this.actual ? 0x80 : this.level;
      this.neutral += Math.sign(toward - this.neutral);
    }
    if (counter % rate.actual === 0) {
      const step = Math.sign(this.level - this.actual);
      if (step) this.actual += step;
      else { const back = Math.sign(this.neutral - this.level); this.actual += back; this.level += back; }
    }
  }
  /** v·(nivel−neutro)/(255−neutro), o /neutro por debajo; 0 en el punto neutro. */
  scale(v) {
    const d = this.level - this.neutral;
    if (d === 0) return 0;
    return d < 0 ? Math.trunc((v * d) / this.neutral) : Math.trunc((v * d) / (255 - this.neutral));
  }
}

export class Person extends Entity {
  constructor(props) {
    super({ ...props, class: 1 });
    this.kind = props.kind;
    this.health = props.health ?? 16;
    this.facing = props.facing ?? 0;          // orientación (0..255)
    this.pitch = 0;                           // inclinación del disparo (+0x1b)
    this.animSet = props.animSet;
    this.anim = -1;
    this.mods = props.mods ?? 0;
    this.baseSpeed = props.baseSpeed ?? 32;
    const bars = props.bars ?? {};
    this.adrenaline = bars.adrenaline ?? new Bar(props.adrenaline?.neutral, props.adrenaline?.level);
    this.intelligence = bars.intelligence ?? new Bar();
    this.perception = bars.perception ?? new Bar();
    this.group = props.group ?? -1;
    this.items = [];
    this.equipped = null;
    this.state = props.state ?? S.IDLE;
    this.nextState = 0;                       // +0x58
    this.destination = null;                  // +0x2e/30/32
    this.events = 0;                          // +0x0c
    this.eventSource = null;                  // +0x16: quién causó el último evento
    this.target = null;                       // +0x2a / +0x2c
    this.timer = 0;                           // +0x42
    this.fireWindow = 0;                      // L, +0x46
    this.following = null;                    // +0x20
    this.vehicle = null;                      // +0x24
    this.driveSpeed = 0;                      // +0x54 al conducir
    this.driveTile = null;                    // +0x34/+0x36: última casilla al conducir
    this.detour = null;                       // +0x1e/+0x59/+0x5a: datos del desvío (SPEC §7.5)
    this.scenarioStart = props.scenarioStart ?? null;
    this.scenario = props.scenarioCurrent ?? null;
    this.objectiveMarked = false;             // +0x1d & 0x10
    this.wanted = false;                      // +0x1d & 2 (buscado por la policía)
    this.aggressive = false;                  // +0x1a & 0x40
    this.canDrop = false;                     // +0x0b & 2
    this.wanders = props.wanders ?? false;    // +0x0b & 0x10: al acabar una acción vuelve a pasear (0x1D)
    this.speed = 0;
    this.lastStepDelta = 0;
    this.regenCounter = 0;                    // +0x53
    this.animEnded = false;
  }

  is(kind) { return (this.kind & kind) !== 0; }
  get isAgent() { return this.is(PersonKind.AGENT); }
  /** Agente de la escuadra del jugador (grupo 0 del jugador; SPEC §5.1). */
  get isPlayerSquad() { return this.playerControlled === true; }
  get scriptControlled() { return this.is(PersonKind.SCRIPTED); }
  get dead() { return this.health < 0 || DEAD.has(this.state) || this.state === S.DYING || this.state === S.DYING_BURNT; }
  get corpse() { return DEAD.has(this.state); }
  get walking() { return WALKING.has(this.state); }

  // ---------- órdenes elementales ----------
  walkTo(x, y, z) { this.order(S.WALK, S.WALK, { x, y, z }); }

  /**
   * Orden del jugador o de la IA (`0x25a10`): si la persona está en un estado que acepta
   * órdenes (`0x258f0`), cambia ya; si no, la orden queda como siguiente estado.
   */
  order(state, next, destination = this.destination) {
    this.destination = destination;
    this.nextState = next;
    if (this.acceptsOrders) this.state = state;
  }

  /** `0x258f0`: no sigue a nadie y está quieto, andando, desviándose, apuntando, huyendo… */
  get acceptsOrders() { return !this.following && ORDERABLE.has(this.state); }
  stop() { this.destination = null; this.state = S.IDLE; this.nextState = 0; }

  /** Siguiente estado al terminar una acción (SPEC §7.1, `0x30250`). */
  finishAction() {
    if (this.nextState === this.state || this.nextState === 0) {
      if (this.following) this.nextState = S.FOLLOW;
      else if (this.wanders) this.nextState = S.WANDER;
      else this.nextState = this.scenarioStart ? S.SCENARIO : S.IDLE;
    }
    this.state = this.nextState;
  }

  /** Resolutor de eventos (SPEC §7.1, `0x30600`): devuelve el estado que toca. */
  resolveEvents(world) {
    const ev = this.events;
    if (!ev) return this.state;
    this.events = 0;
    if (ev & Ev.EXPLOSION) return S.HIT_EXPLOSION;
    if (ev & Ev.FIRE) return S.HIT_FIRE;
    if (ev & Ev.BULLET) return S.HIT_BULLET;
    if (ev & Ev.OTHER) return S.HIT_OTHER;
    if (ev & Ev.LASER) return S.HIT_LASER;
    if ((ev & Ev.PERSUADE) && this.eventSource && world.persuasion.admits(this.eventSource, this)) {
      this.following = this.eventSource;
      this.nextState = S.FOLLOW;
      world.events.emit('sound', { id: 0x0e, at: this });
      return S.CONVERTED;
    }
    return this.state;
  }
}
