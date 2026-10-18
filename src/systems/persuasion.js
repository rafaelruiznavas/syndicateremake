// Persuasión (SPEC §6.4).

import { PersonKind, Ev } from '../entities/person.js';
import { areaEvent } from './vehicles.js';

const CELL = 0x100;                         // cajas de 0x100³ (`0x1eb80`, efecto 0x32)
const eyesLevel = (p) => (p.mods & 0x1800) >> 11;

const brainLevel = (p) => (p.mods >> 9) & 3;

/** Peso de un seguidor para el persuasor (agente 5, policía/guardia 2, criminal/civil 1). */
function followerWeight(p) {
  if (p.is(PersonKind.AGENT)) return 5;
  if (p.is(PersonKind.POLICE) || p.is(PersonKind.GUARD)) return 2;
  if (p.is(PersonKind.CRIMINAL) || p.is(PersonKind.CIVILIAN)) return 1;
  return 0;
}
/** Peso usado al comparar fuerzas de dos grupos (agente 5, policía 4, guardia 3, criminal 2, civil 1). */
function groupWeight(p) {
  if (p.is(PersonKind.AGENT)) return 5;
  if (p.is(PersonKind.POLICE)) return 4;
  if (p.is(PersonKind.GUARD)) return 3;
  if (p.is(PersonKind.CRIMINAL)) return 2;
  if (p.is(PersonKind.CIVILIAN)) return 1;
  return 0;
}

export class Persuasion {
  constructor(world) { this.world = world; }

  followersOf(group, weight) {
    let sum = 0;
    for (const p of this.world.people) if (!p.dead && p.following && p.following.group === group) sum += weight(p);
    return sum;
  }

  /** ¿Convierte `persuader` a `target`? (`0x302a0`) */
  admits(persuader, target) {
    if (target.following && target.following.group === persuader.group) return false;
    if (target.group >= 0 && target.group === persuader.group) return false;
    if (!target.is(PersonKind.AGENT)) {
      const points = this.followersOf(persuader.group, followerWeight) * (brainLevel(persuader) + 1) + 1;
      if (target.is(PersonKind.CIVILIAN)) return true;
      if (target.is(PersonKind.CRIMINAL)) return points > 1;
      if (target.is(PersonKind.GUARD)) return points > 3;
      if (target.is(PersonKind.POLICE)) return points > 7;
      return false;
    }
    const mine = this.followersOf(persuader.group, groupWeight) * (brainLevel(persuader) + 1) + 1;
    const theirs = this.followersOf(target.group, groupWeight) * (brainLevel(target) + 1) + 1;
    return mine > 31 && theirs < mine;
  }

  /**
   * Pulso del PERSUADERTRON (efecto 0x32 de `0x1eb80`): marca el evento 0x400 con una rejilla
   * de cajas de 0x100³ con base en z, centradas desde −n·0x80 hasta +n·0x80 en x e y, donde n
   * es el nivel de los ojos del portador (`+0x3c & 0x1800`). Alcance: ±0x80·(n+1), más el
   * margen de ±0x20 de cada persona.
   */
  pulse(world, persuader) {
    const n = eyesLevel(persuader);
    for (let dx = -n * 0x80; dx <= n * 0x80; dx += CELL) {
      for (let dy = -n * 0x80; dy <= n * 0x80; dy += CELL) {
        areaEvent(world, persuader.x + dx, persuader.y + dy, persuader.z, [CELL, CELL, CELL], Ev.PERSUADE, persuader, persuader);
      }
    }
  }
}
