// Animación (SPEC §5.4): elección de la animación de una persona según su estado y avance de frames.

import { octant } from '../core/angles.js';

const STAND = new Set([0, 1, 6, 7, 8, 0x0b, 0x0c, 0x0d, 0x10, 0x1c, 0x22, 0x24, 0x26, 0x28, 0x29]);
const WALK = new Set([2, 3, 4, 5, 0x0e, 0x0f, 0x1d, 0x1e, 0x1f, 0x20, 0x25, 0x27]);

export class Animator {
  /** @param {{anims:number[], frames:{next:number, flags:number}[]}} sprites  @param {object} tables person-animations.json */
  constructor(sprites, tables) { this.anims = sprites.anims; this.frames = sprites.frames; this.tables = tables; }

  /** Índice de animación para el estado de la persona (tabla de SPEC §5.4). */
  personAnimation(p) {
    const set = p.animSet, w = p.equipped?.weapon ?? 0, f = p.facing, t = this.tables, agentSet = set === 1;
    const s = p.state;
    if (STAND.has(s)) return set + (agentSet ? t.agentStand : t.stand)[w] + octant(f);
    if (WALK.has(s)) return set + (agentSet ? t.agentWalk : t.walk)[w] + octant(f);
    switch (s) {
      case 0x2b: return set + (agentSet ? t.agentFire : t.fire)[w] + octant(f);
      case 0x09: case 0x0a: return set + 0xc0;
      case 0x11: return set + 0xc5;
      case 0x12: case 0x13: case 0x15: case 0x16: return set + 0xc1 + (((f + 0xa0) >> 6) & 3);
      case 0x14: case 0x17: return 0xd0 + (((f + 0x20) >> 6) & 1);
      case 0x18: return set === 1 ? set + 0xcb + (((f + 0x20) >> 6) & 1) * 2 : set + 0xcd;
      case 0x19: return 0xd2;
      case 0x1a: return set === 1 ? (((f + 0x20) >> 6) & 1) * 2 + 0xcd : set + 0xce;
      case 0x1b: return 0xd3;
      case 0x21: return set + 0xc9;
      case 0x23: return 0x33c;
      case 0x2c: return 0xec;
      default: return set + (agentSet ? t.agentStand : t.stand)[w] + octant(f);
    }
  }

  /** Cambia la animación solo si es distinta de la activa (reiniciando en su primer frame). */
  setAnimation(e, anim) {
    if (anim === e.anim) return;
    e.anim = anim;
    e.frame = this.anims[anim] ?? e.frame;
    e.animEnded = false;
  }

  /**
   * Avanza un frame. Devuelve true si la animación acaba de completar una vuelta: el
   * primer frame de cada animación lleva la marca 0x100 en sus flags (datos HFRA).
   */
  advance(e) {
    const f = this.frames[e.frame];
    if (f && f.next) e.frame = f.next;
    const now = this.frames[e.frame];
    e.animEnded = !!(now && (now.flags & 0x100));
    return e.animEnded;
  }

  refreshPerson(p) { this.setAnimation(p, this.personAnimation(p)); }
}
