// Objetos estáticos con estado (SPEC §5.6, `0x2b940`): puertas que se abren al acercarse una
// persona y verjas que se abren al acercarse un vehículo. El subtipo (`+0x19`) es el estado;
// la animación es la base (`+0x0e`) + el paso del ciclo + la variante de orientación.

import { Person } from '../entities/person.js';
import { Vehicle } from '../entities/entity.js';

/** Puertas (personas): cerrada → abriéndose → abierta → cerrándose. */
export const Door = Object.freeze({ CLOSED: 0x0c, OPENING: 0x0d, OPEN: 0x0e, CLOSING: 0x0f });
/** Verjas (vehículos): cerrada → abriéndose → abierta (oculta) → cerrándose. */
export const Gate = Object.freeze({ CLOSED: 0x26, OPENING: 0x27, OPEN: 0x28, CLOSING: 0x29 });

const DOOR_REACH = 0x80, PERSON_HALF = 0x20, DOOR_HEIGHT = 0x100;  // `0x15170` con caja 0x100
const GATE_AREA = 5, GATE_OFFSET = 0x200;                           // `0x152e0`: 5×5 casillas
const CLOSED_TIMER = 0x28;
/** Animaciones fijas de las verjas según el eje (orientación 0/0x80 o 0x40/0xC0). */
const GATE_ANIM = { closed: [0x18b, 0x188], opening: [0x18c, 0x189], closing: [0x18d, 0x18a] };

export class StaticUpdate {
  /** @param {import('../world/world.js').World} world */
  constructor(world) { this.world = world; }

  update(s) {
    if (s.subtype >= Door.CLOSED && s.subtype <= Door.CLOSING) this.#door(s);
    else if (s.subtype >= Gate.CLOSED && s.subtype <= Gate.CLOSING) this.#gate(s);
  }

  /** Variante de orientación de las puertas: `((o + 0x20) >> 6) & 1`. */
  static side(s) { return ((s.heading + 0x20) >> 6) & 1; }

  #door(s) {
    const anim = this.world.animator;
    switch (s.subtype) {
      case Door.CLOSED:
        if (this.personNear(s)) s.subtype = Door.OPENING;
        break;
      case Door.OPENING:
        if (anim.advance(s)) s.subtype = Door.OPEN;
        break;
      case Door.OPEN:
        if (!this.personNear(s)) s.subtype = Door.CLOSING;
        break;
      case Door.CLOSING:
        if (anim.advance(s)) { s.subtype = Door.CLOSED; s.timer = CLOSED_TIMER; }
        break;
    }
    const step = (s.subtype - Door.CLOSED) * 2;
    anim.setAnimation(s, s.baseAnim + step + StaticUpdate.side(s));
  }

  #gate(s) {
    const anim = this.world.animator, axisY = s.heading === 0 || s.heading === 0x80 ? 0 : 1;
    switch (s.subtype) {
      case Gate.CLOSED:
        if (this.vehicleNear(s)) { s.subtype = Gate.OPENING; anim.setAnimation(s, GATE_ANIM.opening[axisY]); }
        else anim.setAnimation(s, GATE_ANIM.closed[axisY]);
        break;
      case Gate.OPENING:
        if (anim.advance(s)) { s.subtype = Gate.OPEN; s.hidden = true; }
        break;
      case Gate.OPEN:
        if (!this.vehicleNear(s)) { s.subtype = Gate.CLOSING; s.hidden = false; anim.setAnimation(s, GATE_ANIM.closing[axisY]); }
        break;
      case Gate.CLOSING:
        if (anim.advance(s)) { s.subtype = Gate.CLOSED; s.timer = CLOSED_TIMER; anim.setAnimation(s, GATE_ANIM.closed[axisY]); }
        break;
    }
  }

  /** ¿Hay una persona visible a ±0x80 (más su ±0x20) y a la altura de la puerta? (`0x15170`) */
  personNear(s) {
    const r = DOOR_REACH + PERSON_HALF;
    for (const e of this.world.grid.query(s.x - r - 0x100, s.y - r - 0x100, s.x + r + 0x100, s.y + r + 0x100)) {
      if (!(e instanceof Person) || e.hidden) continue;
      if (Math.abs(e.x - s.x) <= r && Math.abs(e.y - s.y) <= r && s.z <= e.z + 0x100 && e.z <= s.z + DOOR_HEIGHT) return true;
    }
    return false;
  }

  /** ¿Hay un vehículo visible en las 5×5 casillas que empiezan 2 casillas antes? (`0x152e0`) */
  vehicleNear(s) {
    const x0 = s.x - GATE_OFFSET, y0 = s.y - GATE_OFFSET, x1 = x0 + (GATE_AREA << 8) - 1, y1 = y0 + (GATE_AREA << 8) - 1;
    for (const e of this.world.grid.query(x0, y0, x1, y1)) {
      if (e instanceof Vehicle && !e.hidden && e.x >= x0 && e.x <= x1 && e.y >= y0 && e.y <= y1) return true;
    }
    return false;
  }
}
